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
import { minimalEdit } from './core/textDiff.js';
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
// The exact text the host last loaded into this view.
let lastHostText = null;
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
  rawFromFullText = null;
  syncId = msg.syncId ?? null;
  lastHostText = msg.text;
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
  // The full-text field already sent what the user typed. When its debounced
  // re-parse lands, the model holds only the normalized form of that same
  // text (serializer.js normalizes blank lines between blocks), so don't send
  // it back over the raw text, or the document would flip between the two.
  if (rawFromFullText !== null && text !== lastSent && lastSent === rawFromFullText
    && serializeMarkdown(parseMarkdown(rawFromFullText)) === text) return;
  sendText(text);
}

// The last text sent straight from the full-text field (fast path), if any.
let rawFromFullText = null;

/** Posts the document's new full text, unless the host already has exactly it. */
function sendText(text) {
  const previous = lastSent ?? lastHostText;
  if (text === previous) return;
  lastSent = text;
  counters.editMessages += 1;
  if (sendStrategy.diff) {
    const diff = minimalEdit(previous, text);
    counters.editBytes += diff.text.length;
    post({ type: 'edit', diff, syncId });
    return;
  }
  counters.editBytes += text.length;
  post({ type: 'edit', text, syncId });
}

// --- PROTOTYPE: send strategies, switchable from the benchmark (test mode) ---
const counters = { editMessages: 0, editBytes: 0 };
let sendStrategy = { mode: 'perKeystroke' };
let strategyTimer = null;
function onInput(e) {
  const { mode } = sendStrategy;
  if (mode === 'perKeystroke') { flushAllEdits(); return; }
  if (mode === 'fastPath') {
    // The full-text field holds the whole document: send its text as is,
    // without re-parsing it; the model catches up on the field's own debounce.
    const t = e.target;
    if (t && t.classList?.contains('full-doc-source-textarea')) { sendText(t.value); rawFromFullText = t.value; }
    else flushAllEdits();
    return;
  }
  if (mode === 'off') return;
  if (strategyTimer !== null) return;
  if (mode === 'coalesce') strategyTimer = setTimeout(() => { strategyTimer = null; flushAllEdits(); }, sendStrategy.ms);
  else if (mode === 'frame') strategyTimer = requestAnimationFrame(() => { strategyTimer = null; flushAllEdits(); });
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
        text: getState().doc ? serializeMarkdown(getState().doc) : null,
        hostText: lastHostText,
        viewMode: document.getElementById('view-mode-full-btn')?.getAttribute('aria-selected') === 'true' ? 'full' : 'sections',
        scroll: Object.fromEntries(Object.entries(SCROLLERS).map(([k, id]) => [k, document.getElementById(id)?.scrollTop ?? null])),
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
    case 'setStrategy':
      sendStrategy = { ...msg.strategy };
      return sendStrategy;
    case 'closePreview': {
      const panel = document.getElementById('preview-panel');
      if (panel && !panel.hidden) document.getElementById('preview-edge-toggle')?.click();
      return document.getElementById('preview-panel')?.hidden ?? null;
    }
    case 'bench':
      return runBench(msg);
    case 'addNote': {
      const { addNote } = await import('./markdown/markers.js');
      const node = getSelectedNode();
      updateNode(node.id, { bodyMarkdown: addNote(node.bodyMarkdown) });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      return Boolean(document.querySelector('#section-view .notes-textarea'));
    }
    case 'appendToSelected': {
      const node = getSelectedNode();
      if (!node) return false;
      updateNode(node.id, { bodyMarkdown: `${node.bodyMarkdown}${msg.text}` });
      return true;
    }
    case 'scrollSection': {
      const scroller = document.getElementById(SCROLLERS.section);
      scroller.scrollTop = msg.top;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => { setTimeout(resolve, 250); });
      return scroller.scrollTop;
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
      const selector = { section: '#section-view .content-edit-textarea', note: '#section-view .notes-textarea' }[msg.target] || '.full-doc-source-textarea';
      const ta = document.querySelector(selector);
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

const BENCH_SELECTORS = { full: '.full-doc-source-textarea', section: '#section-view .content-edit-textarea', note: '#section-view .notes-textarea' };

/**
 * Types `keys` characters into a field the way a user does
 * (execCommand('insertText') fires real, trusted input events), one every
 * `intervalMs`, and measures each keystroke: the synchronous handler time,
 * and input-to-next-paint (until after the next animation frame). Long
 * tasks (>50 ms) are collected with a PerformanceObserver.
 */
async function runBench({ target, keys = 30, intervalMs = 80 }) {
  const ta = document.querySelector(BENCH_SELECTORS[target]);
  if (!ta) return { error: `no ${target} field` };
  ta.focus();
  const pos = target === 'full' ? ta.value.indexOf('\n', Math.floor(ta.value.length / 2)) : ta.value.length;
  ta.setSelectionRange(pos, pos);
  const longTasks = [];
  const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
  try { po.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
  const c0 = { ...counters };
  const heap0 = performance.memory?.usedJSHeapSize ?? null;
  const sync = [];
  const paint = [];
  // A frame can stall entirely while the window is occluded or not
  // rendering; those samples are counted, not reported as latency.
  let paintStalls = 0;
  const start = performance.now();
  for (let i = 0; i < keys; i += 1) {
    const t0 = performance.now();
    document.execCommand('insertText', false, 'x');
    const t1 = performance.now();
    const painted = await new Promise((resolve) => {
      const cap = setTimeout(() => resolve(false), 1000);
      requestAnimationFrame(() => setTimeout(() => { clearTimeout(cap); resolve(true); }, 0));
    });
    const t2 = performance.now();
    sync.push(t1 - t0);
    if (painted) paint.push(t2 - t0); else paintStalls += 1;
    const rest = intervalMs - (t2 - t0);
    if (rest > 0) await new Promise((resolve) => { setTimeout(resolve, rest); });
  }
  const typingMs = performance.now() - start;
  // Let any coalesced or debounced edit land.
  await new Promise((resolve) => { setTimeout(resolve, 1500); });
  po.disconnect();
  return {
    sync, paint, paintStalls, longTasks, typingMs,
    messages: counters.editMessages - c0.editMessages,
    bytes: counters.editBytes - c0.editBytes,
    heap0, heap1: performance.memory?.usedJSHeapSize ?? null,
    docLength: lastSerialized ? lastSerialized.length : 0,
    fieldHasText: ta.isConnected && ta.value.split('x').length - 1 >= keys,
  };
}

function onMessage(msg) {
  switch (msg.type) {
    case 'load':
      testMode = Boolean(msg.testMode);
      loadFromHost(msg, { keepSelection: false });
      restoreViewState();
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

// --- view state across webview re-creation --------------------------------
// The selected heading (slug) is saved by onStoreChange. The view mode and
// the scroll positions are saved here, all through vscodeState
// (getState/setState), which survives the webview being hidden and recreated.
const SCROLLERS = { section: 'section-view-wrap', preview: 'preview-panel' };

function trackViewState() {
  const full = document.getElementById('view-mode-full-btn');
  const sections = document.getElementById('view-mode-sections-btn');
  full?.addEventListener('click', () => vscodeState.set({ viewMode: 'full' }));
  sections?.addEventListener('click', () => vscodeState.set({ viewMode: 'sections' }));
  Object.entries(SCROLLERS).forEach(([key, id]) => {
    const scroller = document.getElementById(id);
    let timer = null;
    scroller?.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => vscodeState.set({ scroll: { ...(vscodeState.get().scroll || {}), [key]: scroller.scrollTop } }), 100);
    }, { passive: true });
  });
}

function restoreViewState() {
  const saved = vscodeState.get();
  const btn = saved.viewMode === 'full' ? 'view-mode-full-btn' : saved.viewMode === 'sections' ? 'view-mode-sections-btn' : null;
  if (btn && document.getElementById(btn)?.getAttribute('aria-selected') !== 'true') document.getElementById(btn)?.click();
  if (!saved.scroll) return;
  // After the section view's own swap animation (transitions.js) settles.
  setTimeout(() => {
    Object.entries(SCROLLERS).forEach(([key, id]) => {
      const scroller = document.getElementById(id);
      if (scroller && typeof saved.scroll[key] === 'number') scroller.scrollTop = saved.scroll[key];
    });
  }, 250);
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
  // No debounce window in VS Code: a hidden webview is destroyed without
  // any event reaching the host (retainContextWhenHidden is false), so an
  // edit still waiting in a field's debounce would be lost on a tab switch.
  // Every keystroke's edit is landed and sent at once (fields' own input
  // handlers run first, at the target, then this document-level one).
  document.addEventListener('input', onInput);
  // Belt and braces, for whatever does get a chance to run.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAllEdits(); });
  window.addEventListener('pagehide', flushAllEdits);
  window.addEventListener('blur', flushAllEdits);
  trackViewState();
  post({ type: 'ready' });
}
