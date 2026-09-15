import { parseMarkdown } from './markdown/parser.js';
import { serializeMarkdown } from './markdown/serializer.js';
import { buildSlugIndex } from './markdown/slug.js';
import {
  getState, setState, subscribe, loadDocument, selectSection, getSelectedNode, getSelectedPath, moveSection,
} from './state/store.js';
import {
  getWorkspace, setWorkspace, clearWorkspace, getWorkspaceFile, resolveWorkspaceLink,
} from './state/workspace.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderFilesTree } from './ui/filesPanel.js';
import { renderBreadcrumb } from './ui/breadcrumb.js';
import { renderSectionView } from './ui/cardGrid.js';
import { animatedSwap } from './ui/transitions.js';
import {
  readFile, fetchSample, openFilePicker, writeToHandle, downloadText, supportsFileSystemAccess,
} from './fileIO.js';
import {
  supportsDirectoryPicker, openDirectoryPicker, workspaceFromFileList, readWorkspaceFileText,
} from './workspaceIO.js';
import { showToast } from './ui/toast.js';
import { openSettingsPanel } from './ui/settingsPanel.js';
import { openSourcePanel } from './ui/sourcePanel.js';
import { openAddSectionModal } from './ui/addSectionModal.js';
import { openMapView } from './ui/mapView.js';
import { openRecoveryPanel } from './ui/recoveryPanel.js';
import { confirmDialog } from './ui/confirmDialog.js';
import { debounce } from './utils/debounce.js';
import {
  saveRecoverySnapshot, listRecoverySnapshots, clearRecoverySnapshot,
} from './recovery.js';
import { getTheme, applyTheme } from './utils/theme.js';

// Belt-and-suspenders: index.html already stamps this inline (synchronously,
// before first paint, to avoid a light-then-dark flash) — this just keeps
// the module in sync with whatever was actually applied.
applyTheme(getTheme());

const el = {
  sidebar: document.getElementById('sidebar'),
  workspaceTree: document.getElementById('workspace-tree'),
  headingTree: document.getElementById('heading-tree'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  breadcrumb: document.getElementById('breadcrumb-bar'),
  sectionView: document.getElementById('section-view'),
  emptyState: document.getElementById('empty-state'),
  fileInput: document.getElementById('file-input'),
  openFileBtn: document.getElementById('open-file-btn'),
  folderInput: document.getElementById('folder-input'),
  openFolderBtn: document.getElementById('open-folder-btn'),
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
  const { doc, fileName, dirty, workspaceRelPath } = getState();

  renderFilesTree(el.workspaceTree, getWorkspace(), workspaceRelPath, (relPath) => openWorkspaceFile(relPath), handleCloseWorkspace);

  el.dirtyIndicator.classList.toggle('is-dirty', Boolean(dirty));
  el.dirtyText.textContent = !doc ? 'No document loaded' : dirty ? `${fileName} — unsaved changes` : `${fileName} — up to date`;
  el.sourceBtn.disabled = !doc;
  el.addSectionBtn.disabled = !doc;
  el.mapViewBtn.disabled = !doc;
  el.saveBtn.disabled = !doc;

  if (!doc) {
    el.emptyState.hidden = false;
    el.sectionView.hidden = true;
    el.headingTree.innerHTML = '';
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

  renderSidebar(el.headingTree, doc, path.map((n) => n.id), selectSection, handleSidebarMove);
  renderBreadcrumb(el.breadcrumb, path, doc.id, fileName, selectSection);

  const direction = path.length >= lastPathLength ? 'forward' : 'back';
  lastPathLength = path.length;
  animatedSwap(el.sectionView, (container) => renderSectionView(container, node, handleNavigateFile), direction);
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
// update, including per-keystroke note/content autosaves), one per distinct
// file (see recovery.js). If the tab or browser goes away before a real
// save, the next load offers to restore any of them. `currentBaseline`
// holds whichever file's content is currently active as it was when this
// editing session of it began (set in loadFromText and after a save) — the
// snapshot's `baselineMarkdown`, shown in the recovery panel, so a restore
// prompt can be honest that a snapshot doesn't know about edits made
// outside the app since.
let currentBaseline = null;
const snapshotIfDirty = debounce(() => {
  const {
    doc, fileName, dirty, workspaceRelPath,
  } = getState();
  if (!doc || !dirty) return;
  saveRecoverySnapshot({
    fileName,
    workspaceRelPath,
    workspaceRootName: getWorkspace()?.rootName || null,
    markdown: serializeMarkdown(doc),
    baselineMarkdown: currentBaseline,
  });
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
 * file", drag-drop, a workspace file, following a cross-file link — funnels
 * through here, so this one guard covers all of them: if the current
 * document has unsaved changes, confirm before discarding them.
 * (beforeunload only catches closing the tab/window; it has no say over
 * switching documents within the app.) `workspaceRelPath` records which open
 * workspace file this is (null for a standalone file/sample), and `anchor`
 * — a heading slug — jumps straight to that section once loaded, for a
 * cross-file link like `[...](other.md#some-heading)`.
 */
async function loadFromText(text, fileName, fileHandle = null, { workspaceRelPath = null, anchor = null } = {}) {
  const current = getState();
  if (current.dirty) {
    const ok = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: `"${current.fileName}" has unsaved changes that will be lost. Load "${fileName}" anyway?`,
      confirmLabel: 'Discard & load',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const doc = parseMarkdown(text);
    if (!doc.children.length && !doc.bodyMarkdown.trim()) {
      showToast('That file has no headings or content — nothing to show.', { type: 'error' });
      return;
    }
    // Starting fresh with this exact file's own content — any recovery
    // snapshot for it specifically no longer applies (snapshots for other
    // files are untouched; see recovery.js).
    clearRecoverySnapshot({ fileName, workspaceRelPath, workspaceRootName: getWorkspace()?.rootName || null });
    currentBaseline = text;
    loadDocument({
      doc, fileName, fileHandle, workspaceRelPath,
    });
    if (anchor) {
      const targetId = buildSlugIndex(doc).get(anchor);
      if (targetId) selectSection(targetId);
    }
    showToast(`Loaded ${fileName}`);
  } catch (err) {
    console.error(err);
    showToast(`Could not parse ${fileName}: ${err.message}`, { type: 'error' });
  }
}

/** Read one file from the open workspace and load it as the active document (still funneling through loadFromText's unsaved-changes guard). */
async function openWorkspaceFile(relPath, anchor = null) {
  const entry = getWorkspaceFile(relPath);
  if (!entry) {
    showToast(`"${relPath}" isn't in the open folder.`, { type: 'error' });
    return;
  }
  try {
    const text = await readWorkspaceFileText(entry);
    loadFromText(text, entry.name, entry.fileHandle, { workspaceRelPath: relPath, anchor });
  } catch (err) {
    showToast(`Could not open ${entry.name}: ${err.message}`, { type: 'error' });
  }
}

/**
 * enhanceRenderedContent (markdown/render.js) calls this for any rendered
 * link that isn't a same-page "#anchor" jump; it resolves relative to
 * whichever workspace file is currently open, and returns whether it
 * actually handled it (a link to some other page entirely — an external
 * URL, or a .md file outside this folder — is left to behave normally).
 */
function handleNavigateFile(href) {
  const { workspaceRelPath } = getState();
  if (!workspaceRelPath) return false;
  const resolved = resolveWorkspaceLink(workspaceRelPath, href);
  if (!resolved) return false;
  openWorkspaceFile(resolved.relPath, resolved.anchor);
  return true;
}

function handleCloseWorkspace() {
  clearWorkspace();
  render();
}

async function handleWorkspaceOpened({ rootName, files }) {
  if (!files.length) {
    showToast(`No Markdown files found in "${rootName}".`, { type: 'error' });
    return;
  }
  setWorkspace({ rootName, files });
  showToast(`Opened "${rootName}" — ${files.length} Markdown file${files.length === 1 ? '' : 's'} found.`);
  const sorted = files.slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const preferred = sorted.find((f) => !f.relPath.includes('/') && /^(README|INDEX)\.(md|markdown)$/i.test(f.name));
  await openWorkspaceFile((preferred || sorted[0]).relPath);
}

/** Offer to restore whatever crash-recovery snapshots are left over from before the app last closed cleanly — one panel listing all of them, not a blind prompt for whichever file happened to be edited last. */
function checkForRecovery() {
  const snapshots = listRecoverySnapshots();
  if (!snapshots.length) return;

  openRecoveryPanel(snapshots, {
    onRestore(snapshot) {
      try {
        const doc = parseMarkdown(snapshot.markdown);
        currentBaseline = snapshot.baselineMarkdown ?? snapshot.markdown;
        loadDocument({
          doc,
          fileName: snapshot.fileName,
          fileHandle: null,
          dirty: true,
          workspaceRelPath: snapshot.workspaceRelPath,
        });
        clearRecoverySnapshot(snapshot);
        showToast(`Restored unsaved work for "${snapshot.fileName}"`);
      } catch (err) {
        console.error(err);
        showToast(`Could not restore "${snapshot.fileName}"`, { type: 'error' });
      }
    },
    onDiscard(snapshot) {
      clearRecoverySnapshot(snapshot);
    },
  });
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

el.openFolderBtn.addEventListener('click', async () => {
  if (supportsDirectoryPicker) {
    try {
      const result = await openDirectoryPicker();
      if (result) await handleWorkspaceOpened(result);
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Could not open folder: ${err.message}`, { type: 'error' });
    }
  } else {
    el.folderInput.click();
  }
});

el.folderInput.addEventListener('change', async (e) => {
  const { files } = e.target;
  if (!files || !files.length) return;
  await handleWorkspaceOpened(workspaceFromFileList(files));
  el.folderInput.value = '';
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
  const { doc, fileName, fileHandle, workspaceRelPath } = getState();
  if (!doc) return;
  const text = serializeMarkdown(doc);
  const identity = { fileName, workspaceRelPath, workspaceRootName: getWorkspace()?.rootName || null };

  if (fileHandle) {
    try {
      await writeToHandle(fileHandle, text);
      setState({ dirty: false });
      clearRecoverySnapshot(identity);
      currentBaseline = text;
      showToast(`Saved to ${fileName}`);
    } catch (err) {
      showToast(`Save failed: ${err.message}`, { type: 'error' });
    }
    return;
  }

  downloadText(fileName || 'document.md', text);
  setState({ dirty: false });
  clearRecoverySnapshot(identity);
  currentBaseline = text;
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
