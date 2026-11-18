// "Hosted single-document mode": the app running inside a VS Code Custom
// Text Editor webview (vscode-extension/). VS Code owns the file — save,
// dirty state, undo, revert, hot exit — so this module:
//  - loads whatever text the host sends (on open, and on every external
//    change: the plain text editor, git, undo/revert in VS Code);
//  - posts the serialized document back after every in-app edit;
//  - mirrors VS Code's dirty flag into the store instead of computing it;
//  - flushes debounced field edits when VS Code is about to save.
// Everything that assumes the app owns files (Explorer, open/add file,
// GitHub, Changes, recovery, search across folders) is hidden by
// css/vscode.css and gated off in js/main.js behind `isHosted`.
import {
  isVSCode, post, onHostMessage, vscodeState,
} from './core/vscodeBridge.js';
import { parseMarkdown } from './markdown/parser.js';
import { serializeMarkdown } from './markdown/serializer.js';
import { buildSlugMaps } from './markdown/slug.js';
import { setImageBaseUri } from './markdown/render.js';
import {
  getState, setState, subscribe, loadDocument, selectSection, getDocSession, flushPendingEdits,
  getSelectedNode, updateNode, registerPendingFlush,
} from './state/store.js';

export const isHosted = isVSCode;

// Which store document session belongs to the host's document. An edit is
// only ever posted for this session, so nothing else that might load a
// document can overwrite the file VS Code has open.
let hostedSession = -1;
// The serialized form of the document as the host last knew it. Compared
// against on every store change, so opening (and saving) an untouched file
// never sends an edit, even for a file whose parse/serialize round trip is
// not byte-identical.
let lastSerialized = null;
// The last text this webview actually sent, or null if it hasn't sent
// anything since the host's text last replaced it.
let lastSent = null;
// Which host load/externalChange this view is based on; sent back with every
// edit so the host can rebase an edit made before a newer change arrived.
let syncId = null;
let testMode = false;

const diagnostics = { cspViolations: [], errors: [] };

if (isHosted) {
  window.addEventListener('securitypolicyviolation', (e) => {
    const detail = `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`;
    diagnostics.cspViolations.push(detail);
    post({ type: 'diagnostic', kind: 'csp', detail });
  });
  window.addEventListener('error', (e) => {
    const detail = e.error?.message || e.message || 'unknown error';
    diagnostics.errors.push(detail);
    post({ type: 'diagnostic', kind: 'error', detail });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const detail = e.reason?.message || String(e.reason);
    diagnostics.errors.push(detail);
    post({ type: 'diagnostic', kind: 'error', detail });
  });
}

function selectedSlug() {
  const { doc, selectedId } = getState();
  if (!doc || !selectedId) return null;
  return buildSlugMaps(doc).idToSlug.get(selectedId) ?? null;
}

function selectBySlug(slug) {
  const { doc } = getState();
  if (!doc || !slug) return;
  const id = buildSlugMaps(doc).slugToId.get(slug);
  if (id) selectSection(id);
}

function loadFromHost(msg, { keepSelection }) {
  // Which heading was selected, by slug: parseMarkdown hands out fresh ids
  // on every parse, so an id from the old tree never matches the new one.
  const slug = keepSelection ? selectedSlug() : (vscodeState.get().selectedSlug ?? null);
  if (typeof msg.documentBaseUri === 'string') setImageBaseUri(msg.documentBaseUri);
  const doc = parseMarkdown(msg.text);
  lastSerialized = serializeMarkdown(doc);
  lastSent = null;
  syncId = msg.syncId ?? null;
  loadDocument({ doc, fileName: msg.fileName || getState().fileName, dirty: Boolean(msg.isDirty) });
  hostedSession = getDocSession();
  selectBySlug(slug);
}

function onStoreChange(state) {
  if (!state.doc || getDocSession() !== hostedSession) return;
  const slug = selectedSlug();
  if (slug !== (vscodeState.get().selectedSlug ?? null)) vscodeState.set({ selectedSlug: slug });
  const text = serializeMarkdown(state.doc);
  if (text === lastSerialized) return;
  lastSerialized = text;
  lastSent = text;
  post({ type: 'edit', text, syncId });
}

/**
 * VS Code only (a no-op elsewhere): lets a debounced text field's pending
 * edit be landed synchronously, through the store's existing
 * registerPendingFlush mechanism, before a save or when the tab is hidden.
 * Synchronous on purpose: a hidden webview is torn down without running
 * any more timers, and blurring the field instead (as the standalone app's
 * Ctrl+S does) would take focus away mid-typing on every autosave.
 * `flush` must be a no-op when nothing is pending.
 */
export function registerHostedFieldFlush(field, flush) {
  if (!isHosted) return;
  const unregister = registerPendingFlush(() => {
    flush();
    if (!field.isConnected) unregister();
  });
}

/** Lands every debounced field edit now; posting it is synchronous too (onStoreChange). */
function flushAllEdits() {
  flushPendingEdits();
}

async function answerHostRequest(msg) {
  let result = null;
  if (msg.op === 'flush') {
    flushAllEdits();
    result = { text: lastSent, syncId };
  } else if (testMode) {
    result = await runTestOp(msg);
  }
  post({ type: 'hostResponse', id: msg.id, result });
}

/**
 * Operations the extension-host test suite (vscode-extension/test/) uses to
 * drive and inspect the real webview. Only honoured when the host says it
 * is running its tests (context.extensionMode === Test).
 */
async function runTestOp(msg) {
  switch (msg.op) {
    case 'probe':
      return {
        hasDoc: Boolean(getState().doc),
        fileName: getState().fileName,
        dirty: getState().dirty,
        selectedSlug: selectedSlug(),
        vendors: {
          hljs: Boolean(window.hljs), markdownit: Boolean(window.markdownit), DOMPurify: Boolean(window.DOMPurify), mermaid: Boolean(window.mermaid),
        },
        mermaidSvgs: document.querySelectorAll('.mermaid svg').length,
        highlighted: document.querySelectorAll('pre.hljs').length,
        images: [...document.querySelectorAll('img')].map((img) => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })),
        explorerVisible: Boolean(document.getElementById('explorer-section')?.offsetParent),
        openFileVisible: Boolean(document.getElementById('open-file-btn')?.offsetParent),
        bodyClasses: document.body.className,
        active: {
          tag: document.activeElement?.tagName || null,
          connected: Boolean(document.activeElement?.isConnected),
          className: document.activeElement?.className || '',
        },
        cspViolations: diagnostics.cspViolations.slice(),
        errors: diagnostics.errors.slice(),
      };
    case 'appendToSelected': {
      const node = getSelectedNode();
      if (!node) return false;
      updateNode(node.id, { bodyMarkdown: `${node.bodyMarkdown}${msg.text}` });
      return true;
    }
    case 'select':
      selectBySlug(msg.slug);
      return selectedSlug();
    case 'viewMode':
      document.getElementById(msg.mode === 'full' ? 'view-mode-full-btn' : 'view-mode-sections-btn')?.click();
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      return true;
    case 'typePending': {
      // Types into the full-text editor without waiting for its debounce,
      // leaving the edit pending, as a fast Ctrl/Cmd+S would.
      const ta = document.querySelector('.full-doc-source-textarea');
      if (!ta) return false;
      ta.focus();
      ta.value += msg.text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    case 'clickLink': {
      const a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === msg.href);
      if (!a) return false;
      a.click();
      return true;
    }
    case 'callClaude': {
      const { callClaude } = await import('./ai/client.js');
      try {
        return { text: await callClaude({ model: 'test-model', prompt: msg.prompt }) };
      } catch (err) {
        return { error: err.message };
      }
    }
    case 'storageDump': {
      // Everything this webview persists, to check the API key is never in it.
      const local = {};
      try {
        for (let i = 0; i < localStorage.length; i += 1) local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
      } catch { /* unavailable */ }
      return { local, state: vscodeState.get() };
    }
    case 'storage':
      try {
        if (msg.set) localStorage.setItem(msg.key, msg.value);
        return { value: localStorage.getItem(msg.key), vscodeState: vscodeState.get()[msg.key] ?? null, origin: window.location.origin };
      } catch (err) {
        return { error: err.message };
      } finally {
        if (msg.set) vscodeState.set({ [msg.key]: msg.value });
      }
    default:
      return null;
  }
}

function onMessage(msg) {
  switch (msg.type) {
    case 'load':
      testMode = Boolean(msg.testMode);
      loadFromHost(msg, { keepSelection: false });
      break;
    case 'externalChange':
      loadFromHost(msg, { keepSelection: true });
      break;
    case 'dirty':
      if (getState().dirty !== Boolean(msg.isDirty)) setState({ dirty: Boolean(msg.isDirty) });
      break;
    case 'hostRequest':
      answerHostRequest(msg);
      break;
    default:
      break;
  }
}

/** The dirty indicator's click: VS Code's own Save. */
export function hostedSave() {
  post({ type: 'save' });
}

/** A rendered link that isn't a same-page #anchor: the host opens it (another .md in MD.Orchestra, a URL externally). */
export function hostedNavigateFile(href) {
  post({ type: 'openLink', href });
  return true;
}

/** Called once, at the very end of js/main.js, after every listener is registered. */
export function initHostedMode({ dirtyIndicator }) {
  document.body.classList.add('hosted-vscode');
  if (dirtyIndicator) dirtyIndicator.title = 'Save (VS Code Save, Ctrl/⌘+S)';
  subscribe(onStoreChange);
  onHostMessage(onMessage);
  // Land pending field edits whenever the webview may be about to go away
  // (tab hidden or closed) or loses focus.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAllEdits(); });
  window.addEventListener('pagehide', flushAllEdits);
  window.addEventListener('blur', flushAllEdits);
  post({ type: 'ready' });
}
