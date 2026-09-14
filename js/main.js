import { parseMarkdown } from './markdown/parser.js';
import { serializeMarkdown } from './markdown/serializer.js';
import {
  getState, setState, subscribe, loadDocument, selectSection, getSelectedNode, getSelectedPath, moveSection,
} from './state/store.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderBreadcrumb } from './ui/breadcrumb.js';
import { renderSectionView } from './ui/cardGrid.js';
import { animatedSwap } from './ui/transitions.js';
import {
  readFile, fetchSample, openFilePicker, writeToHandle, downloadText, supportsFileSystemAccess,
} from './fileIO.js';
import { showToast } from './ui/toast.js';
import { openSettingsPanel } from './ui/settingsPanel.js';
import { openSourcePanel } from './ui/sourcePanel.js';
import { openAddSectionModal } from './ui/addSectionModal.js';
import { openMapView } from './ui/mapView.js';
import { debounce } from './utils/debounce.js';
import { saveRecoverySnapshot, loadRecoverySnapshot, clearRecoverySnapshot } from './recovery.js';
import { getTheme, applyTheme } from './utils/theme.js';

// Belt-and-suspenders: index.html already stamps this inline (synchronously,
// before first paint, to avoid a light-then-dark flash) — this just keeps
// the module in sync with whatever was actually applied.
applyTheme(getTheme());

const el = {
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  breadcrumb: document.getElementById('breadcrumb-bar'),
  sectionView: document.getElementById('section-view'),
  emptyState: document.getElementById('empty-state'),
  fileInput: document.getElementById('file-input'),
  openFileBtn: document.getElementById('open-file-btn'),
  samplesBtn: document.getElementById('samples-btn'),
  samplesDropdown: document.getElementById('samples-dropdown'),
  emptySampleBtn: document.getElementById('empty-sample-btn'),
  addSectionBtn: document.getElementById('add-section-btn'),
  mapViewBtn: document.getElementById('map-view-btn'),
  saveBtn: document.getElementById('save-btn'),
  sourceBtn: document.getElementById('source-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  dirtyIndicator: document.getElementById('dirty-indicator'),
  dirtyText: document.getElementById('dirty-text'),
};

let lastPathLength = 0;

function render() {
  const { doc, fileName, dirty } = getState();

  el.dirtyIndicator.classList.toggle('is-dirty', Boolean(dirty));
  el.dirtyText.textContent = !doc ? 'No document loaded' : dirty ? `${fileName} — unsaved changes` : `${fileName} — up to date`;
  el.sourceBtn.disabled = !doc;
  el.addSectionBtn.disabled = !doc;
  el.mapViewBtn.disabled = !doc;
  el.saveBtn.disabled = !doc;

  if (!doc) {
    el.emptyState.hidden = false;
    el.sectionView.hidden = true;
    el.sidebar.innerHTML = '';
    el.breadcrumb.innerHTML = '';
    lastPathLength = 0;
    return;
  }

  el.emptyState.hidden = true;
  el.sectionView.hidden = false;

  // A note/title edit fires a store update on every autosave tick. If the user is
  // still typing in a field inside the card grid, rebuilding that DOM out from under
  // them would drop focus, jump the cursor, and swallow whatever they type next — so
  // skip the rebuild entirely until they click away. Nothing else changes while typing
  // a note (sidebar/breadcrumb reflect headings, not note text), so this is always safe.
  const active = document.activeElement;
  if (active && el.sectionView.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    return;
  }

  const node = getSelectedNode();
  const path = getSelectedPath();
  if (!node) return;

  renderSidebar(el.sidebar, doc, path.map((n) => n.id), selectSection, handleSidebarMove);
  renderBreadcrumb(el.breadcrumb, path, doc.id, fileName, selectSection);

  const direction = path.length >= lastPathLength ? 'forward' : 'back';
  lastPathLength = path.length;
  animatedSwap(el.sectionView, (container) => renderSectionView(container, node), direction);
}

/** Drag-and-drop reordering/relocating in the sidebar — see sidebar.js. */
function handleSidebarMove({ nodeId, referenceId, placement }) {
  if (!moveSection({ nodeId, referenceId, placement })) {
    showToast("Can't move a section into itself or its own subsection", { type: 'error' });
  }
}

subscribe(render);
render();

// Crash recovery: while there are unsaved changes, keep a snapshot of the
// current Markdown in localStorage (debounced — this fires on every store
// update, including per-keystroke note/content autosaves). If the tab or
// browser goes away before a real save, the next load offers to restore it.
const snapshotIfDirty = debounce(() => {
  const { doc, fileName, dirty } = getState();
  if (doc && dirty) saveRecoverySnapshot({ fileName, markdown: serializeMarkdown(doc) });
}, 1500);
subscribe(snapshotIfDirty);

// The standard "leave site?" browser confirmation — works the same whether
// this is a normal tab or a window opened from an installed PWA shortcut.
window.addEventListener('beforeunload', (e) => {
  if (getState().dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/**
 * Every entry point that replaces the loaded document — samples, "Open .md
 * file", drag-drop — funnels through here, so this one guard covers all of
 * them: if the current document has unsaved changes, confirm before
 * discarding them. (beforeunload only catches closing the tab/window; it
 * has no say over switching documents within the app.)
 */
function loadFromText(text, fileName, fileHandle = null) {
  const current = getState();
  if (current.dirty && !window.confirm(
    `"${current.fileName}" has unsaved changes that will be lost. Load "${fileName}" anyway?`,
  )) {
    return;
  }
  try {
    const doc = parseMarkdown(text);
    if (!doc.children.length && !doc.bodyMarkdown.trim()) {
      showToast('That file has no headings or content — nothing to show.', { type: 'error' });
      return;
    }
    clearRecoverySnapshot(); // starting fresh with a (possibly different) file — any older recovery snapshot no longer applies
    loadDocument({ doc, fileName, fileHandle });
    showToast(`Loaded ${fileName}`);
  } catch (err) {
    console.error(err);
    showToast(`Could not parse ${fileName}: ${err.message}`, { type: 'error' });
  }
}

/** Offer to restore a crash-recovery snapshot left over from before the app last closed. */
function checkForRecovery() {
  const snapshot = loadRecoverySnapshot();
  if (!snapshot || !snapshot.markdown) return;
  const when = new Date(snapshot.savedAt).toLocaleString();
  const shouldRestore = window.confirm(
    `Found unsaved work from last time: "${snapshot.fileName}" (${when}).\n\nRestore it? (Cancel discards it — this can't be undone.)`,
  );
  if (!shouldRestore) { clearRecoverySnapshot(); return; }
  try {
    const doc = parseMarkdown(snapshot.markdown);
    loadDocument({
      doc, fileName: snapshot.fileName, fileHandle: null, dirty: true,
    });
    showToast(`Restored unsaved work for "${snapshot.fileName}"`);
  } catch (err) {
    console.error(err);
    showToast('Could not restore the recovered file', { type: 'error' });
    clearRecoverySnapshot();
  }
}
checkForRecovery();

el.openFileBtn.addEventListener('click', async () => {
  if (supportsFileSystemAccess) {
    try {
      const picked = await openFilePicker();
      if (picked) loadFromText(picked.text, picked.fileName, picked.handle);
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Could not open file: ${err.message}`, { type: 'error' });
    }
  } else {
    el.fileInput.click();
  }
});

el.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFile(file);
  loadFromText(text, file.name);
  el.fileInput.value = '';
});

el.samplesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.samplesDropdown.hidden = !el.samplesDropdown.hidden;
});
document.addEventListener('click', (e) => {
  if (!el.samplesDropdown.hidden && !e.target.closest('.samples-menu')) el.samplesDropdown.hidden = true;
});

async function loadSample(path) {
  try {
    const text = await fetchSample(path);
    loadFromText(text, path);
  } catch (err) {
    showToast(err.message, { type: 'error' });
  }
}

el.samplesDropdown.querySelectorAll('button[data-sample]').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadSample(btn.dataset.sample);
    el.samplesDropdown.hidden = true;
  });
});
el.emptySampleBtn.addEventListener('click', () => loadSample('sample.md'));

/**
 * The one obvious way to persist changes: write straight back to the file
 * if it was opened via "Open .md file" (a real File System Access handle),
 * otherwise download the up-to-date Markdown. Either way counts as
 * "saved" — the in-memory doc is no longer ahead of what the user has.
 */
async function handleSave() {
  const { doc, fileName, fileHandle } = getState();
  if (!doc) return;
  const text = serializeMarkdown(doc);

  if (fileHandle) {
    try {
      await writeToHandle(fileHandle, text);
      setState({ dirty: false });
      clearRecoverySnapshot();
      showToast(`Saved to ${fileName}`);
    } catch (err) {
      showToast(`Save failed: ${err.message}`, { type: 'error' });
    }
    return;
  }

  downloadText(fileName || 'document.md', text);
  setState({ dirty: false });
  clearRecoverySnapshot();
  showToast(
    supportsFileSystemAccess
      ? `Downloaded ${fileName} — this document wasn't opened with the file picker, so replace the original file with the download (or use "Open .md file" next time to save in place).`
      : `Downloaded ${fileName} — replace the original file with the download to keep it in sync.`,
    { duration: 5000 },
  );
}

el.saveBtn.addEventListener('click', handleSave);
el.dirtyIndicator.addEventListener('click', handleSave);

el.addSectionBtn.addEventListener('click', openAddSectionModal);
el.mapViewBtn.addEventListener('click', openMapView);
el.sourceBtn.addEventListener('click', openSourcePanel);
el.settingsBtn.addEventListener('click', openSettingsPanel);
el.sidebarToggle.addEventListener('click', () => {
  const isNarrowViewport = window.matchMedia('(max-width: 860px)').matches;
  el.sidebar.classList.toggle(isNarrowViewport ? 'sidebar-open' : 'sidebar-collapsed');
});

// Registering this lets a supporting browser offer "Install app" — opening
// in its own standalone window, like a desktop app, rather than a tab.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker registration failed', err));
  });
}

['dragover', 'drop'].forEach((evt) => window.addEventListener(evt, (e) => e.preventDefault()));
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    showToast('Only .md / .markdown / .txt files are supported.', { type: 'error' });
    return;
  }
  const text = await readFile(file);
  loadFromText(text, file.name);
});
