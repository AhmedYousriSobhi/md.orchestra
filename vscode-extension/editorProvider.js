// The CustomTextEditorProvider: MD.Orchestra's UI in a webview, bound to a
// real vscode.TextDocument. VS Code owns save, dirty state, undo, revert and
// hot exit; the webview only sends the serialized document after each
// in-app edit, and the host applies it as one minimal WorkspaceEdit.
//
// Message protocol (webview <-> host):
//   webview -> host  {type:'ready'}                       host replies with 'load'
//                    {type:'edit', text}                  full serialized document
//                    {type:'save'}                        run document.save()
//                    {type:'openLink', href}              relative link clicked
//                    {type:'request', id, op, ...payload} ai / hasApiKey / setApiKey / clearApiKey
//                    {type:'hostResponse', id, result}    answer to a host request
//                    {type:'diagnostic', kind, detail}    CSP violation / script error
//   host -> webview  {type:'load'|'externalChange', text, fileName, isDirty, documentBaseUri}
//                    {type:'dirty', isDirty}
//                    {type:'response', id, result | error}
//                    {type:'hostRequest', id, op, ...}    'flush' (before save), or test-only ops
const path = require('path');
const vscode = require('vscode');
const { computeMinimalEdit, applyMinimalEdit, rebaseEdit } = require('./minimalEdit');
const { buildWebviewHtml } = require('./webviewHtml');
const aiProxy = require('./aiProxy');

const VIEW_TYPE = 'mdOrchestra.editor';
const FLUSH_TIMEOUT_MS = 1000;

class MdOrchestraEditorProvider {
  constructor(context) {
    this.context = context;
    this.isTestMode = context.extensionMode === vscode.ExtensionMode.Test;
    /** Every live editor, for the extension-host tests. */
    this.sessions = new Set();
  }

  async resolveCustomTextEditor(document, panel) {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const docDir = document.uri.with({ path: path.posix.dirname(document.uri.path) });
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, docDir] };

    const session = {
      panel,
      document,
      ready: false,
      readyWaiters: [],
      // Echo suppression: the version and text our own WorkspaceEdit will
      // produce. Set *before* applyEdit, because onDidChangeTextDocument
      // can fire before applyEdit's promise resolves.
      expectedVersion: null,
      expectedText: null,
      // Every load/externalChange carries a syncId, and the webview echoes
      // the one it last received with each edit. bases maps syncId -> the
      // text the webview's view held under it (what it was sent, then each
      // edit it made). An edit whose base is no longer the document's text
      // was made before the webview saw a newer change, and is rebased (see
      // planEdit), never applied as-is.
      syncSeq: 0,
      bases: new Map(),
      editChain: Promise.resolve(),
      hostSeq: 0,
      hostPending: new Map(),
      // Recorded for tests: every message posted to this webview, and every
      // diagnostic (CSP violation, uncaught error) it reported.
      sent: [],
      received: [],
      diagnostics: [],
    };
    this.sessions.add(session);

    const post = (msg) => {
      if (this.isTestMode) session.sent.push(msg);
      return panel.webview.postMessage(msg);
    };
    session.post = post;
    // A load/externalChange payload: the current text, under a new syncId.
    const snapshot = () => {
      session.syncSeq += 1;
      const text = document.getText();
      session.bases.set(session.syncSeq, text);
      if (session.bases.size > 50) session.bases.delete(session.bases.keys().next().value);
      return { syncId: session.syncSeq, ...docInfo(text) };
    };
    const docInfo = (text) => ({
      text,
      fileName: path.posix.basename(document.uri.path),
      isDirty: document.isDirty,
      documentBaseUri: panel.webview.asWebviewUri(docDir).toString(),
      testMode: this.isTestMode,
    });
    session.snapshot = snapshot;

    const disposables = [];

    disposables.push(panel.webview.onDidReceiveMessage((msg) => this.onMessage(session, msg, snapshot)));

    disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (!e.contentChanges.length) {
        // Dirty-state-only change (e.g. after a save or revert to saved).
        if (session.ready) post({ type: 'dirty', isDirty: document.isDirty });
        return;
      }
      const isOwnEcho = e.document.version === session.expectedVersion
        && e.document.getText() === session.expectedText;
      if (isOwnEcho) {
        session.expectedVersion = null;
        session.expectedText = null;
        if (session.ready) post({ type: 'dirty', isDirty: document.isDirty });
        return;
      }
      if (session.ready) post({ type: 'externalChange', ...snapshot() });
    }));

    disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === document.uri.toString() && session.ready) post({ type: 'dirty', isDirty: doc.isDirty });
    }));

    // Field edits in the app are debounced. Before VS Code writes the file,
    // ask the webview to land whatever is still pending, so Ctrl/Cmd+S right
    // after typing never saves stale text.
    disposables.push(vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString() || !session.ready) return;
      e.waitUntil(this.flushEdits(session));
    }));

    panel.onDidDispose(() => {
      disposables.forEach((d) => d.dispose());
      session.hostPending.forEach(({ resolve }) => resolve(null));
      this.sessions.delete(session);
    });

    panel.webview.html = await buildWebviewHtml(panel.webview, mediaRoot);
  }

  onMessage(session, msg, snapshot) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isTestMode) session.received.push(msg);
    switch (msg.type) {
      case 'ready':
        // Sent on every webview (re)load, which can happen more than once
        // per editor (e.g. if retainContextWhenHidden is ever turned off), so
        // always resend the document's *current* text.
        session.ready = true;
        session.post({ type: 'load', ...snapshot() });
        session.readyWaiters.splice(0).forEach((fn) => fn());
        break;
      case 'edit':
        if (typeof msg.text === 'string') this.queueEdit(session, msg.text, msg.syncId);
        break;
      case 'save':
        session.document.save();
        break;
      case 'openLink':
        this.openLink(session.document, String(msg.href || ''));
        break;
      case 'request':
        this.handleRequest(session, msg);
        break;
      case 'hostResponse': {
        const pending = session.hostPending.get(msg.id);
        if (pending) {
          session.hostPending.delete(msg.id);
          pending.resolve(msg.result);
        }
        break;
      }
      case 'diagnostic':
        session.diagnostics.push({ kind: msg.kind, detail: msg.detail });
        if (this.isTestMode) console.log(`[mdOrchestra webview ${msg.kind}]`, msg.detail);
        break;
      default:
        break;
    }
  }

  /** Edits are applied strictly in order, one at a time. */
  queueEdit(session, text, syncId) {
    session.editChain = session.editChain
      .then(() => this.applyText(session, text, syncId))
      .catch((err) => console.error('MD.Orchestra: applying an edit failed', err));
    return session.editChain;
  }

  /**
   * Works out how to apply the webview's full text, made under `syncId`, to
   * the document as it is now: `{ edit, resultText, rebased }`, or
   * `{ conflict: true }`. Records `text` as that webview's new base.
   */
  planEdit(session, text, syncId) {
    const current = session.document.getText();
    const base = session.bases.has(syncId) ? session.bases.get(syncId) : null;
    if (session.bases.has(syncId)) session.bases.set(syncId, text);
    if (base === null || base === current) {
      return { edit: computeMinimalEdit(current, text), resultText: text, rebased: false };
    }
    const r = rebaseEdit(base, text, current);
    if (r.conflict) return { conflict: true };
    return { edit: r.edit, resultText: applyMinimalEdit(current, r.edit), rebased: true };
  }

  reportConflict(session) {
    vscode.window.showWarningMessage('MD.Orchestra: your last edit in MD.Orchestra overlapped a change made elsewhere in this file at the same moment, so it was not applied. The view now shows the file as it is.');
    session.post({ type: 'externalChange', ...session.snapshot() });
  }

  async applyText(session, text, syncId) {
    const { document } = session;
    const plan = this.planEdit(session, text, syncId);
    if (plan.conflict) { this.reportConflict(session); return false; }
    if (!plan.edit) {
      if (plan.rebased) session.post({ type: 'externalChange', ...session.snapshot() });
      return true;
    }
    const { edit } = plan;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
    if (!plan.rebased) {
      session.expectedVersion = document.version + 1;
      session.expectedText = plan.resultText;
    }
    const ok = await vscode.workspace.applyEdit(workspaceEdit);
    if (!ok) {
      session.expectedVersion = null;
      session.expectedText = null;
      // The document didn't take the edit (e.g. read-only); put the webview
      // back in sync with what the document really holds.
      session.post({ type: 'externalChange', ...session.snapshot() });
      return false;
    }
    // A rebased edit isn't suppressed as an echo: the resulting change event
    // sends the merged text back, so the view shows both changes.
    return true;
  }

  /** Asks the webview for any not-yet-sent edit; resolves to TextEdits for onWillSave. */
  async flushEdits(session) {
    const result = await this.hostRequest(session, 'flush', {}, FLUSH_TIMEOUT_MS);
    await session.editChain;
    const text = result && typeof result.text === 'string' ? result.text : null;
    if (text === null) return [];
    const plan = this.planEdit(session, text, result.syncId);
    if (plan.conflict) { this.reportConflict(session); return []; }
    if (!plan.edit) return [];
    const { document } = session;
    if (!plan.rebased) {
      session.expectedVersion = document.version + 1;
      session.expectedText = plan.resultText;
    }
    const { edit } = plan;
    return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text)];
  }

  hostRequest(session, op, payload = {}, timeoutMs = 5000) {
    const id = ++session.hostSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { session.hostPending.delete(id); resolve(null); }, timeoutMs);
      session.hostPending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
      session.post({ type: 'hostRequest', id, op, ...payload });
    });
  }

  async handleRequest(session, msg) {
    const { secrets } = this.context;
    let result;
    let error;
    try {
      switch (msg.op) {
        case 'ai':
          result = await aiProxy.callClaude(secrets, msg);
          break;
        case 'hasApiKey':
          result = await aiProxy.hasApiKey(secrets);
          break;
        case 'setApiKey':
          result = await aiProxy.setApiKey(secrets, msg.value);
          break;
        case 'clearApiKey':
          await aiProxy.clearApiKey(secrets);
          result = true;
          break;
        default:
          error = `Unknown request "${msg.op}"`;
      }
    } catch (err) {
      error = err.message || String(err);
    }
    session.post({ type: 'response', id: msg.id, result, error });
  }

  async openLink(document, href) {
    if (/^https?:/i.test(href)) {
      vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const [rawPath] = href.split('#');
    if (!rawPath) return;
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { decoded = rawPath; }
    const target = document.uri.with({ path: path.posix.resolve(path.posix.dirname(document.uri.path), decoded), fragment: '', query: '' });
    if (/\.(md|markdown)$/i.test(target.path)) {
      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    } else {
      await vscode.commands.executeCommand('vscode.open', target);
    }
  }

  // --- test helpers -------------------------------------------------------
  sessionsFor(uri) {
    return [...this.sessions].filter((s) => s.document.uri.toString() === uri.toString());
  }

  waitReady(session, timeoutMs = 20000) {
    if (session.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      session.readyWaiters.push(() => { clearTimeout(timer); resolve(true); });
    });
  }
}

module.exports = { MdOrchestraEditorProvider, VIEW_TYPE };
