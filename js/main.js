import { parseMarkdown } from './markdown/parser.js';
import { serializeMarkdown } from './markdown/serializer.js';
import { buildSlugIndex } from './markdown/slug.js';
import { findChangedNodes } from './markdown/diff.js';
import { applySectionToBase, revertSectionToBase } from './markdown/sectionMerge.js';
import {
  getState, setState, subscribe, loadDocument, selectSection, getSelectedNode, getSelectedPath, moveSection, updateNode,
} from './state/store.js';
import { addNote } from './markdown/markers.js';
import {
  getWorkspace, setWorkspace, clearWorkspace, getWorkspaceFile, resolveWorkspaceLink,
} from './state/workspace.js';
import { recordLinksFor, clearLinkIndex } from './state/linkIndex.js';
import { renderSidebar } from './ui/sidebar.js';
import {
  renderFilesTree, getSidebarActiveOnTop, setSidebarActiveOnTop, getWorkspaceViewMode, setWorkspaceViewMode,
} from './ui/filesPanel.js';
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
import { openChangesPanel } from './ui/changesPanel.js';
import { confirmDialog } from './ui/confirmDialog.js';
import {
  renderPreviewPanel, getPreviewScope, setPreviewScope, getPreviewOpen, setPreviewOpen,
} from './ui/previewPanel.js';
import { openCodeViewer } from './ui/codeViewer.js';
import { debounce } from './utils/debounce.js';
import {
  saveRecoverySnapshot, listRecoverySnapshots, clearRecoverySnapshot as clearRecoverySnapshotRaw, snapshotIdentity,
} from './recovery.js';
import { getTheme, applyTheme } from './utils/theme.js';

// Belt-and-suspenders: index.html already stamps this inline (synchronously,
// before first paint, to avoid a light-then-dark flash) — this just keeps
// the module in sync with whatever was actually applied.
applyTheme(getTheme());

const el = {
  appBody: document.getElementById('app-body'),
  sidebar: document.getElementById('sidebar'),
  workspaceTree: document.getElementById('workspace-tree'),
  headingTree: document.getElementById('heading-tree'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  breadcrumb: document.getElementById('breadcrumb-bar'),
  sectionViewWrap: document.getElementById('section-view-wrap'),
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
  previewToggleBtn: document.getElementById('preview-edge-toggle'),
  previewPanel: document.getElementById('preview-panel'),
  noteSeamBtn: document.getElementById('note-seam-btn'),
  saveBtn: document.getElementById('save-btn'),
  changesBtn: document.getElementById('changes-btn'),
  changesBadge: document.getElementById('changes-badge'),
  sourceBtn: document.getElementById('source-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  dirtyIndicator: document.getElementById('dirty-indicator'),
  dirtyText: document.getElementById('dirty-text'),
};

// Preview defaults to open (every newly-selected section previews live
// alongside it) rather than starting collapsed every session — see
// ui/previewPanel.js's getPreviewOpen/setPreviewOpen and the edge-toggle
// wiring below, which persists it once the user actually flips it.
el.previewPanel.hidden = !getPreviewOpen();

let lastPathLength = 0;

/**
 * A thin, never-throwing wrapper around the real render logic below. This
 * runs on every state change (and is called directly in several places
 * besides), so one bad render — triggered by some edge-case document or
 * leftover localStorage state — must never take the rest of the app down
 * with it: without this, an uncaught exception here would abort whichever
 * caller invoked it, which for the very first call (right after this
 * function is defined) means every line after it in this file — all of
 * the addEventListener() calls that make the buttons work at all — would
 * simply never run.
 */
function render() {
  try {
    renderInner();
  } catch (err) {
    console.error('render() failed; the UI may be out of date until the next update.', err);
  }
}

function renderInner() {
  const { doc, fileName, dirty, workspaceRelPath } = getState();

  updateChangesBadge();

  const workspace = getWorkspace();
  const activeOnTop = getSidebarActiveOnTop();
  // The workspace tree collapses out of the way (and the heading tree —
  // the active document's own outline — moves above it) exactly when the
  // active document isn't actually one of the workspace's own files: a
  // loaded sample, or a plain file opened alongside an open folder,
  // otherwise visually reads as if it belongs under that directory.
  const isWorkspaceFileActive = Boolean(workspace) && Boolean(workspaceRelPath) && Boolean(getWorkspaceFile(workspaceRelPath));
  const workspaceCollapsed = activeOnTop && Boolean(workspace) && !isWorkspaceFileActive;
  el.sidebar.insertBefore(
    workspaceCollapsed ? el.headingTree : el.workspaceTree,
    workspaceCollapsed ? el.workspaceTree : el.headingTree,
  );

  el.sidebar.classList.toggle('sidebar-graph-mode', getWorkspaceViewMode() === 'graph' && Boolean(workspace) && !workspaceCollapsed);
  renderFilesTree(el.workspaceTree, workspace, workspaceRelPath, (relPath) => openWorkspaceFile(relPath), handleCloseWorkspace, {
    collapsed: workspaceCollapsed,
    activeOnTop,
    onToggleActiveOnTop: handleToggleSidebarOrder,
    viewMode: getWorkspaceViewMode(),
    onToggleViewMode: handleToggleWorkspaceViewMode,
  });

  el.dirtyIndicator.classList.toggle('is-dirty', Boolean(dirty));
  el.dirtyText.textContent = !doc ? 'No document loaded' : dirty ? `${fileName} — unsaved changes` : `${fileName} — up to date`;
  el.sourceBtn.disabled = !doc;
  el.addSectionBtn.disabled = !doc;
  el.mapViewBtn.disabled = !doc;
  el.previewToggleBtn.disabled = !doc;
  el.saveBtn.disabled = !doc;
  // Drives the edge-toggle tab's docked position (see css/layout.css) — it
  // sits at the preview panel's own edge while open, and the viewport's
  // edge while closed.
  el.appBody.classList.toggle('preview-open', !el.previewPanel.hidden);

  if (!doc) {
    el.emptyState.hidden = false;
    el.sectionView.hidden = true;
    el.headingTree.innerHTML = '';
    el.breadcrumb.innerHTML = '';
    el.previewPanel.innerHTML = '';
    lastPathLength = 0;
    return;
  }

  el.emptyState.hidden = true;
  el.sectionView.hidden = false;

  const node = getSelectedNode();
  const path = getSelectedPath();
  if (!node) return;

  // Rendered ahead of the card grid's own focus guard below, deliberately:
  // updating it live as you type elsewhere (in a note, in the card's
  // content editor) is the entire point of a preview pane. But the preview
  // panel now has its own editable textarea too (editing a section in
  // place — see previewPanel.js), so it needs the exact same protection
  // the card grid gets below: skip rebuilding it while its own textarea is
  // focused, or an unrelated update elsewhere would wipe out whatever's
  // mid-edit there.
  const activeInPreview = document.activeElement;
  const previewIsBeingEdited = activeInPreview && el.previewPanel.contains(activeInPreview)
    && (activeInPreview.tagName === 'TEXTAREA' || activeInPreview.tagName === 'INPUT');
  if (!el.previewPanel.hidden && !previewIsBeingEdited) {
    renderPreviewPanel(el.previewPanel, {
      doc,
      node,
      scope: getPreviewScope(),
      onScopeChange: handlePreviewScopeChange,
      onClose: handleClosePreview,
      onOpenCode: ({ lang, code }) => openCodeViewer({ lang, code, title: node.title }),
      onNavigate: selectSection,
      onNavigateFile: handleNavigateFile,
      fileName,
    });
  }

  // A note/title edit fires a store update on every autosave tick. If the user is
  // still typing in a field inside the card grid, rebuilding that DOM out from under
  // them would drop focus, jump the cursor, and swallow whatever they type next — so
  // skip the rebuild entirely until they click away. Nothing else changes while typing
  // a note (sidebar/breadcrumb reflect headings, not note text), so this is always safe.
  const active = document.activeElement;
  if (active && el.sectionView.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    return;
  }

  renderSidebar(el.headingTree, doc, path.map((n) => n.id), selectSection, handleSidebarMove);
  renderBreadcrumb(el.breadcrumb, path, doc.id, fileName, selectSection);

  const direction = path.length >= lastPathLength ? 'forward' : 'back';
  lastPathLength = path.length;
  animatedSwap(el.sectionView, (container) => renderSectionView(container, node, handleNavigateFile), direction);
}

function handlePreviewScopeChange(scope) {
  setPreviewScope(scope);
  render();
}

function handleClosePreview() {
  el.previewPanel.hidden = true;
  el.previewPanel.innerHTML = '';
  // Without this, closing via the preview panel's own "✕" (as opposed to
  // the edge-toggle tab, whose click handler renders itself afterward)
  // never re-syncs #app-body's preview-open class — see renderInner() —
  // leaving the edge-toggle tab docked at its "open" position instead of
  // sliding back out to the collapsed one.
  render();
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
/** The actual snapshot-writing logic, callable directly (bypassing the debounce below) when something needs the current dirty state captured *right now* — see handleChangesOpenSnapshot, which relies on this to make switching files from the Changes panel non-destructive without needing a confirm prompt. */
function snapshotNow() {
  const {
    doc, fileName, dirty, workspaceRelPath,
  } = getState();
  if (!doc || !dirty) return;
  const identity = { fileName, workspaceRelPath, workspaceRootName: getWorkspace()?.rootName || null };
  const serialized = serializeMarkdown(doc);
  // `dirty` only means "something touched this doc since it loaded" — it
  // doesn't know whether that edit actually left the content any different
  // from what's on disk. An edit immediately undone (or one that otherwise
  // round-trips back to the exact same content, e.g. regenerating a ToC
  // and then undoing it) still sets dirty:true, since updateNode/undoNode
  // have no notion of "baseline" to check against — only this function
  // does. Catching that here, rather than blindly re-persisting a snapshot
  // that would diff to zero real changes, is what keeps the Changes badge
  // from reporting a change that no longer exists.
  if (currentBaseline !== null && serialized === currentBaseline) {
    setState({ dirty: false });
    clearRecoverySnapshot(identity);
    return;
  }
  saveRecoverySnapshot({
    ...identity,
    markdown: serialized,
    baselineMarkdown: currentBaseline,
  });
  // Writing a snapshot is a side effect, not a setState() — nothing else
  // would otherwise re-render the Changes button's badge to reflect it
  // until some unrelated state change happened to trigger render() again.
  updateChangesBadge();
}
const snapshotIfDirty = debounce(snapshotNow, 1500);
subscribe(snapshotIfDirty);

/** The badge (and the Changes panel's own subtitle) count individual changed *sections* across every pending file, not just how many files have any changes — editing two different sections of the same file is two changes, not one. */
function updateChangesBadge() {
  const pendingCount = listRecoverySnapshots().reduce((sum, snap) => sum + countChangedSections(snap), 0);
  el.changesBadge.hidden = pendingCount === 0;
  el.changesBadge.textContent = String(pendingCount);
}

/**
 * The list of {id, title, level} sections a snapshot actually touched, vs.
 * its own baseline — see markdown/diff.js. `null` (not an empty array) when
 * there's no baseline to compare against or either parse fails — a real,
 * successfully-computed diff can legitimately be an empty array (every
 * edit since baseline got undone again), and that must stay distinguishable
 * from "couldn't tell": countChangedSections() below treats them very
 * differently.
 */
function diffSnapshot(snap) {
  if (!snap.baselineMarkdown) return null;
  try {
    return findChangedNodes(parseMarkdown(snap.markdown), parseMarkdown(snap.baselineMarkdown));
  } catch {
    return null;
  }
}

/** How many individual sections (not files) a snapshot represents — the real diffed count when one's available, or 1 as a fallback only for a legacy/undiffable snapshot with no baseline (there's still *something* unsaved, we just can't say which section — never claim "at least 1" for a snapshot that genuinely diffed to zero). */
function countChangedSections(snap) {
  const diff = diffSnapshot(snap);
  return diff === null ? 1 : diff.length;
}

/** clearRecoverySnapshot() is a side effect, not a setState() — nothing else would re-render the Changes badge to reflect it, so every call site in this file goes through here instead of the raw import. */
function clearRecoverySnapshot(identity) {
  clearRecoverySnapshotRaw(identity);
  updateChangesBadge();
}

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
    // A free ride on content we're already parsing: whatever this file
    // links to elsewhere in the workspace is now known, for the focal
    // graph's link-edge overlay — see state/linkIndex.js.
    if (workspaceRelPath) recordLinksFor(workspaceRelPath, doc);
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
  clearLinkIndex();
  render();
}

function handleToggleWorkspaceViewMode() {
  setWorkspaceViewMode(getWorkspaceViewMode() === 'graph' ? 'list' : 'graph');
  render();
}

function handleToggleSidebarOrder() {
  setSidebarActiveOnTop(!getSidebarActiveOnTop());
  render();
}

async function handleWorkspaceOpened({ rootName, files }) {
  if (!files.length) {
    showToast(`No Markdown files found in "${rootName}".`, { type: 'error' });
    return;
  }
  setWorkspace({ rootName, files });
  clearLinkIndex();
  showToast(`Opened "${rootName}" — ${files.length} Markdown file${files.length === 1 ? '' : 's'} found.`);
  const sorted = files.slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const preferred = sorted.find((f) => !f.relPath.includes('/') && /^(README|INDEX)\.(md|markdown)$/i.test(f.name));
  await openWorkspaceFile((preferred || sorted[0]).relPath);
}

/**
 * Load a crash-recovery snapshot's content as the active document (dirty —
 * it was never actually saved). Shared by the startup recovery flow and
 * the on-demand Changes panel's "Open" action; neither the snapshot's
 * fileHandle (never persisted — can't be) is available here, so it loads
 * without direct save-back until re-saved or re-opened.
 *
 * Reuses `snapshot.doc` when present (set by enrichSnapshot()) rather than
 * re-parsing `snapshot.markdown` here — parseMarkdown() hands out fresh ids
 * every call (see utils/id.js), so a *second* parse of the exact same text
 * produces a structurally-identical tree with completely different id
 * values; an id computed against an earlier parse (elsewhere, for the
 * Changes panel's own section list) would silently match nothing in a
 * freshly re-parsed one. Lands on `sectionId` if given (the Changes panel
 * jumping to one specific listed change), otherwise on whichever section
 * was actually edited first (see markdown/diff.js), not just wherever the
 * document opens by default.
 */
function loadSnapshotAsActive(snapshot, sectionId = null) {
  try {
    const doc = snapshot.doc ?? parseMarkdown(snapshot.markdown);
    currentBaseline = snapshot.baselineMarkdown ?? snapshot.markdown;
    loadDocument({
      doc,
      fileName: snapshot.fileName,
      fileHandle: null,
      dirty: true,
      workspaceRelPath: snapshot.workspaceRelPath,
    });
    let targetId = sectionId;
    if (!targetId && snapshot.changedSections) {
      targetId = snapshot.changedSections[0]?.id ?? null;
    } else if (!targetId && snapshot.baselineMarkdown) {
      try {
        targetId = findChangedNodes(doc, parseMarkdown(snapshot.baselineMarkdown))[0]?.id ?? null;
      } catch {
        targetId = null;
      }
    }
    if (targetId) selectSection(targetId);
    clearRecoverySnapshot(snapshot);
    showToast(`Restored unsaved work for "${snapshot.fileName}"`);
  } catch (err) {
    console.error(err);
    showToast(`Could not restore "${snapshot.fileName}"`, { type: 'error' });
  }
}

/** Offer to restore whatever crash-recovery snapshots are left over from before the app last closed cleanly — one panel listing all of them, not a blind prompt for whichever file happened to be edited last. */
function checkForRecovery() {
  const snapshots = listRecoverySnapshots();
  if (!snapshots.length) return;

  openRecoveryPanel(snapshots, {
    onRestore: loadSnapshotAsActive,
    onDiscard(snapshot) {
      clearRecoverySnapshot(snapshot);
    },
  });
}
// Called directly (not through the store), so — same reasoning as render()
// above — it's guarded here too: whatever's sitting in localStorage from a
// much earlier version of this feature (or another one entirely) must
// never be able to stop every line below this one, all of the
// addEventListener() calls that make the rest of the app work, from
// running at all.
try {
  checkForRecovery();
} catch (err) {
  console.error('Crash-recovery check failed on startup.', err);
}

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
      return;
    }
    notifyOtherPendingChanges(identity);
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
  notifyOtherPendingChanges(identity);
}

/**
 * After a save, surface anything ELSE still unsaved (a different file
 * edited earlier in this browser and never saved) rather than letting it
 * sit silently out of view — this is the "which are saving/pending" visibility
 * the Save flow lacked when more than one file's worth of changes exist.
 */
function notifyOtherPendingChanges(justSavedIdentity) {
  const savedId = snapshotIdentity(justSavedIdentity);
  const others = listRecoverySnapshots().filter((s) => s.id !== savedId);
  if (!others.length) return;
  openChangesPanel(others.map(enrichSnapshot), null, changesPanelHandlers);
}

/**
 * Attaches each snapshot's own parsed `doc` (so opening it later reuses
 * these exact node ids instead of re-parsing — see loadSnapshotAsActive)
 * and its list of individually-changed sections, for the Changes panel to
 * render as separate, individually-jumpable entries within that one
 * file's row.
 */
function enrichSnapshot(snap) {
  try {
    const doc = parseMarkdown(snap.markdown);
    // `null` (not `[]`) when there's no baseline to diff against — the
    // Changes panel needs to tell "couldn't determine what changed" apart
    // from "diffed it, genuinely nothing did" (see diffSnapshot() above).
    const changedSections = snap.baselineMarkdown ? findChangedNodes(doc, parseMarkdown(snap.baselineMarkdown)) : null;
    return { ...snap, doc, changedSections };
  } catch {
    return { ...snap, doc: null, changedSections: null };
  }
}

/**
 * Same idea as enrichSnapshot(), but for the row representing the file
 * that's *currently* the live active document: diffed against the real
 * in-memory doc (and currentBaseline) rather than re-parsing the
 * snapshot's own cached markdown, so its section ids are the real,
 * currently-selectable ones — clicking one just needs selectSection(), no
 * reload (see handleChangesOpenSection).
 */
function enrichActiveSnapshot(snap) {
  const { doc: liveDoc } = getState();
  if (!liveDoc || !currentBaseline) return enrichSnapshot(snap);
  try {
    return { ...snap, doc: liveDoc, changedSections: findChangedNodes(liveDoc, parseMarkdown(currentBaseline)) };
  } catch {
    return enrichSnapshot(snap);
  }
}

/** Save one pending snapshot (from the Changes panel) directly to disk, without switching away from whatever's currently open. `isActive` means this row IS the live document, so it just goes through the normal save path. */
async function handleChangesSave(snapshot, isActive) {
  if (isActive) {
    await handleSave();
    return;
  }
  const entry = snapshot.workspaceRelPath ? getWorkspaceFile(snapshot.workspaceRelPath) : null;
  try {
    if (entry && entry.fileHandle) {
      await writeToHandle(entry.fileHandle, snapshot.markdown);
      showToast(`Saved to ${snapshot.fileName}`);
    } else {
      downloadText(snapshot.fileName, snapshot.markdown);
      showToast(`Downloaded ${snapshot.fileName} — no live file handle for it in this session, so replace the original with the download.`, { duration: 5000 });
    }
    clearRecoverySnapshot(snapshot);
  } catch (err) {
    showToast(`Could not save ${snapshot.fileName}: ${err.message}`, { type: 'error' });
  }
}

/** Where a section-level save (see handleChangesSaveSection) should write its merged content: the same file handle a whole-file save would use, active document or not. */
function resolveWriteHandle(isActive, snapshot) {
  if (isActive) return getState().fileHandle;
  const entry = snapshot.workspaceRelPath ? getWorkspaceFile(snapshot.workspaceRelPath) : null;
  return entry?.fileHandle || null;
}

async function writeMarkdownFor(isActive, snapshot, text) {
  const fileName = isActive ? getState().fileName : snapshot.fileName;
  const handle = resolveWriteHandle(isActive, snapshot);
  if (handle) {
    await writeToHandle(handle, text);
    showToast(`Saved to ${fileName}`);
  } else {
    downloadText(fileName, text);
    showToast(`Downloaded ${fileName} — no live file handle for it in this session, so replace the original with the download.`, { duration: 5000 });
  }
}

/**
 * Save just ONE changed section (from the Changes panel's per-section
 * controls) straight to disk, leaving every other pending section's edit
 * exactly as unsaved as it was: builds a Markdown document that's the
 * file's current on-disk content (its baseline) everywhere *except* this
 * one section, which comes from the edited version (see
 * markdown/sectionMerge.js), and writes that. Falls back to a full-file
 * save if there's no baseline to diff against at all (a legacy snapshot
 * predating per-section tracking — nothing to merge with).
 */
async function handleChangesSaveSection(snapshot, isActive, sectionId) {
  const baseText = isActive ? currentBaseline : snapshot.baselineMarkdown;
  if (!baseText) {
    await handleChangesSave(snapshot, isActive);
    return;
  }
  const editedDoc = isActive ? getState().doc : (snapshot.doc ?? parseMarkdown(snapshot.markdown));
  const baseDoc = parseMarkdown(baseText);
  const merged = applySectionToBase(baseDoc, editedDoc, sectionId);
  if (!merged) return;
  const mergedText = serializeMarkdown(merged);
  try {
    await writeMarkdownFor(isActive, snapshot, mergedText);
  } catch (err) {
    showToast(`Save failed: ${err.message}`, { type: 'error' });
    return;
  }
  // Everything else still pending is whatever the live/edited doc still
  // disagrees with the file we just wrote — i.e. every OTHER section that
  // was changed, since this one now matches on disk.
  const remaining = findChangedNodes(editedDoc, merged);
  if (isActive) {
    currentBaseline = mergedText;
    if (!remaining.length) {
      setState({ dirty: false });
      clearRecoverySnapshot(snapshot);
    } else {
      snapshotNow();
    }
  } else {
    const identity = { fileName: snapshot.fileName, workspaceRelPath: snapshot.workspaceRelPath, workspaceRootName: snapshot.workspaceRootName };
    if (!remaining.length) {
      clearRecoverySnapshot(identity);
    } else {
      saveRecoverySnapshot({ ...identity, markdown: snapshot.markdown, baselineMarkdown: mergedText });
      updateChangesBadge();
    }
  }
}

/**
 * Discard just ONE changed section's edit (from the Changes panel),
 * reverting it back to the file's baseline while leaving every other
 * pending section's edit untouched (see markdown/sectionMerge.js). For the
 * active document this mutates the live in-memory doc directly (not via
 * loadDocument, which would reset the current selection/undo history —
 * unwanted for reverting a single section elsewhere in the tree); confirms
 * first, same as discarding the whole active file, since it's just as
 * irreversible for that one section. Non-active files skip the confirm,
 * matching handleChangesDiscard's reasoning: nothing currently open is at
 * risk, just a cached pending edit.
 */
async function handleChangesDiscardSection(snapshot, isActive, sectionId) {
  const baseText = isActive ? currentBaseline : snapshot.baselineMarkdown;
  if (!baseText) return;
  const baseDoc = parseMarkdown(baseText);

  if (isActive) {
    const ok = await confirmDialog({
      title: 'Discard this section\'s changes?',
      message: 'This reverts just this section back to its last saved version, discarding everything changed in it since. This can\'t be undone.',
      confirmLabel: 'Discard section',
      danger: true,
    });
    if (!ok) return;
    const reverted = revertSectionToBase(baseDoc, getState().doc, sectionId);
    if (!reverted) return;
    const remaining = findChangedNodes(reverted, baseDoc);
    setState({ doc: reverted, dirty: Boolean(remaining.length) });
    if (!remaining.length) {
      clearRecoverySnapshot(snapshot);
    } else {
      snapshotNow();
    }
    return;
  }

  const editedDoc = snapshot.doc ?? parseMarkdown(snapshot.markdown);
  const reverted = revertSectionToBase(baseDoc, editedDoc, sectionId);
  if (!reverted) return;
  const remaining = findChangedNodes(reverted, baseDoc);
  const identity = { fileName: snapshot.fileName, workspaceRelPath: snapshot.workspaceRelPath, workspaceRootName: snapshot.workspaceRootName };
  if (!remaining.length) {
    clearRecoverySnapshot(identity);
  } else {
    saveRecoverySnapshot({ ...identity, markdown: serializeMarkdown(reverted), baselineMarkdown: baseText });
    updateChangesBadge();
  }
}

/**
 * "Open" a pending snapshot from the Changes panel: switch to it as the
 * active document. Unlike every *other* document-load path (a sample,
 * "Open .md file", a link), this one skips the unsaved-changes confirm —
 * deliberately: everything about the current document that's actually at
 * risk is captured by force-flushing its own recovery snapshot right here
 * (snapshotNow(), bypassing its usual debounce), so it stays exactly as
 * recoverable — via this very panel — as it already was. Nothing is
 * actually being discarded by switching, just leaving one already-tracked
 * file for another, so warning about it would be both untrue and noise.
 */
function handleChangesOpenSnapshot(snapshot) {
  snapshotNow();
  loadSnapshotAsActive(snapshot);
}

/**
 * Same idea as handleChangesOpenSnapshot, but for jumping straight to one
 * specific listed change within a file rather than wherever the first
 * change happens to be. If that file is already the live document (its
 * row was enriched with the real in-memory doc — see enrichActiveSnapshot
 * — so `sectionId` is one of its actual, currently-valid ids), this is
 * just a plain in-place jump: no reload, no snapshot, nothing to lose.
 */
function handleChangesOpenSection(snapshot, sectionId) {
  const current = getState();
  const currentId = current.doc
    ? snapshotIdentity({ fileName: current.fileName, workspaceRelPath: current.workspaceRelPath, workspaceRootName: getWorkspace()?.rootName || null })
    : null;
  if (snapshot.id === currentId) {
    selectSection(sectionId);
    return;
  }
  snapshotNow();
  loadSnapshotAsActive(snapshot, sectionId);
}

/**
 * Discard a pending snapshot from the Changes panel. For any other file,
 * that's just dropping the cached copy — nothing currently loaded is
 * affected. For the *active* document, there's a real in-memory edit to
 * throw away too: revert it back to currentBaseline (the content this
 * editing session started from — set on load and after every save) rather
 * than just clearing the safety-net snapshot and leaving the unsaved edit
 * sitting in memory unchanged.
 */
async function handleChangesDiscard(snapshot, isActive) {
  if (!isActive) {
    clearRecoverySnapshot(snapshot);
    return;
  }
  const ok = await confirmDialog({
    title: 'Discard unsaved changes?',
    message: `This reverts "${snapshot.fileName}" back to its last saved version, discarding everything changed since. This can't be undone.`,
    confirmLabel: 'Discard changes',
    danger: true,
  });
  if (!ok) return;
  try {
    const { fileHandle, workspaceRelPath } = getState();
    const doc = parseMarkdown(currentBaseline);
    loadDocument({
      doc, fileName: snapshot.fileName, fileHandle, dirty: false, workspaceRelPath,
    });
    clearRecoverySnapshot(snapshot);
    showToast(`Discarded unsaved changes to "${snapshot.fileName}"`);
  } catch (err) {
    console.error(err);
    showToast(`Could not discard changes: ${err.message}`, { type: 'error' });
  }
}

const changesPanelHandlers = {
  onSaveFile: handleChangesSave,
  onSaveSection: handleChangesSaveSection,
  onOpen: handleChangesOpenSnapshot,
  onOpenSection: handleChangesOpenSection,
  onDiscardFile: handleChangesDiscard,
  onDiscardSection: handleChangesDiscardSection,
};

function handleOpenChanges() {
  const { doc, fileName, workspaceRelPath } = getState();
  const activeId = doc ? snapshotIdentity({ fileName, workspaceRelPath, workspaceRootName: getWorkspace()?.rootName || null }) : null;
  const enriched = listRecoverySnapshots().map((snap) => (snap.id === activeId ? enrichActiveSnapshot(snap) : enrichSnapshot(snap)));
  openChangesPanel(enriched, activeId, changesPanelHandlers);
}

el.saveBtn.addEventListener('click', handleSave);
el.dirtyIndicator.addEventListener('click', handleSave);
el.changesBtn.addEventListener('click', handleOpenChanges);

el.addSectionBtn.addEventListener('click', openAddSectionModal);
el.mapViewBtn.addEventListener('click', openMapView);
el.previewToggleBtn.addEventListener('click', () => {
  if (el.previewPanel.hidden) {
    el.previewPanel.hidden = false;
    setPreviewOpen(true);
    render();
  } else {
    setPreviewOpen(false);
    handleClosePreview(); // renders itself
  }
});
/**
 * A quick "add a note" button that floats on the seam between the content
 * pane and the preview panel, rather than only living inside the currently
 * focused card's own notes editor — hovering near the shared border from
 * either side reveals it at the cursor's height, right on whichever side
 * you're actually on (a cosmetic mirror, not a different action: it always
 * adds a note to whatever section is currently selected, the same one the
 * card view and the preview are both already showing). Only meaningful
 * when there's actually a seam to hover near — a loaded document, and the
 * preview panel open beside it.
 */
const SEAM_HOVER_THRESHOLD = 48;
let seamHideTimer = null;

function positionSeamButton(clientX, clientY, side) {
  if (seamHideTimer) { clearTimeout(seamHideTimer); seamHideTimer = null; }
  if (!getState().doc || el.previewPanel.hidden) return;
  const appBodyRect = el.appBody.getBoundingClientRect();
  el.noteSeamBtn.hidden = false;
  el.noteSeamBtn.classList.add('note-seam-btn-visible');
  el.noteSeamBtn.classList.toggle('note-seam-btn-content', side === 'content');
  el.noteSeamBtn.classList.toggle('note-seam-btn-preview', side === 'preview');
  el.noteSeamBtn.style.left = `${clientX - appBodyRect.left}px`;
  el.noteSeamBtn.style.top = `${clientY - appBodyRect.top}px`;
}

function scheduleHideSeamButton() {
  if (seamHideTimer) clearTimeout(seamHideTimer);
  seamHideTimer = setTimeout(() => {
    el.noteSeamBtn.classList.remove('note-seam-btn-visible');
    el.noteSeamBtn.hidden = true;
    seamHideTimer = null;
  }, 150);
}

el.sectionViewWrap.addEventListener('mousemove', (e) => {
  if (el.previewPanel.hidden) return;
  const rect = el.sectionViewWrap.getBoundingClientRect();
  const distFromSeam = rect.right - e.clientX;
  if (distFromSeam >= 0 && distFromSeam <= SEAM_HOVER_THRESHOLD) {
    positionSeamButton(rect.right - 6, e.clientY, 'content');
  } else {
    scheduleHideSeamButton();
  }
});
el.sectionViewWrap.addEventListener('mouseleave', scheduleHideSeamButton);

el.previewPanel.addEventListener('mousemove', (e) => {
  const rect = el.previewPanel.getBoundingClientRect();
  const distFromSeam = e.clientX - rect.left;
  if (distFromSeam >= 0 && distFromSeam <= SEAM_HOVER_THRESHOLD) {
    positionSeamButton(rect.left + 6, e.clientY, 'preview');
  } else {
    scheduleHideSeamButton();
  }
});
el.previewPanel.addEventListener('mouseleave', scheduleHideSeamButton);

el.noteSeamBtn.addEventListener('mouseenter', () => {
  if (seamHideTimer) { clearTimeout(seamHideTimer); seamHideTimer = null; }
});
el.noteSeamBtn.addEventListener('mouseleave', scheduleHideSeamButton);
el.noteSeamBtn.addEventListener('click', () => {
  const node = getSelectedNode();
  if (!node) return;
  updateNode(node.id, { bodyMarkdown: addNote(node.bodyMarkdown) });
  showToast('Note added — open the section to fill it in.');
  scheduleHideSeamButton();
});

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
