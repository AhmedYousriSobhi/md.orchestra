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
const { computeMinimalEdit } = require('./minimalEdit');
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
      editChain: Promise.resolve(),
      hostSeq: 0,
      hostPending: new Map(),
      // Recorded for tests: every message posted to this webview, and every
      // diagnostic (CSP violation, uncaught error) it reported.
      sent: [],
      diagnostics: [],
    };
    this.sessions.add(session);

    const post = (msg) => {
      session.sent.push(msg);
      return panel.webview.postMessage(msg);
    };
    session.post = post;
    const snapshot = () => ({
      text: document.getText(),
      fileName: path.posix.basename(document.uri.path),
      isDirty: document.isDirty,
      documentBaseUri: panel.webview.asWebviewUri(docDir).toString(),
      testMode: this.isTestMode,
    });

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
    switch (msg.type) {
      case 'ready':
        // Sent on every webview (re)load. With retainContextWhenHidden off,
        // showing a hidden tab reloads the webview from scratch, so always
        // resend the document's *current* text.
        session.ready = true;
        session.post({ type: 'load', ...snapshot() });
        session.readyWaiters.splice(0).forEach((fn) => fn());
        break;
      case 'edit':
        if (typeof msg.text === 'string') this.queueEdit(session, msg.text);
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
  queueEdit(session, text) {
    session.editChain = session.editChain
      .then(() => this.applyText(session, text))
      .catch((err) => console.error('MD.Orchestra: applying an edit failed', err));
    return session.editChain;
  }

  async applyText(session, text) {
    const { document } = session;
    const edit = computeMinimalEdit(document.getText(), text);
    if (!edit) return true;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
    session.expectedVersion = document.version + 1;
    session.expectedText = text;
    const ok = await vscode.workspace.applyEdit(workspaceEdit);
    if (!ok) {
      session.expectedVersion = null;
      session.expectedText = null;
      // The document didn't take the edit (e.g. read-only); put the webview
      // back in sync with what the document really holds.
      session.post({ type: 'externalChange', text: document.getText(), isDirty: document.isDirty });
    }
    return ok;
  }

  /** Asks the webview for any not-yet-sent edit; resolves to TextEdits for onWillSave. */
  async flushEdits(session) {
    const result = await this.hostRequest(session, 'flush', {}, FLUSH_TIMEOUT_MS);
    await session.editChain;
    const text = result && typeof result.text === 'string' ? result.text : null;
    if (text === null) return [];
    const { document } = session;
    const edit = computeMinimalEdit(document.getText(), text);
    if (!edit) return [];
    session.expectedVersion = document.version + 1;
    session.expectedText = text;
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
