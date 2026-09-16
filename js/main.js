import { h } from './utils/dom.js';
import { parseMarkdown } from './markdown/parser.js';
import { serializeMarkdown } from './markdown/serializer.js';
import { buildSlugIndex } from './markdown/slug.js';
import { findChangedNodes } from './markdown/diff.js';
import { applySectionToBase, revertSectionToBase } from './markdown/sectionMerge.js';
import {
  getState, setState, subscribe, loadDocument, selectSection, getSelectedNode, getSelectedPath, moveSection, updateNode,
} from './state/store.js';
import { addNote } from './markdown/markers.js';
import { focusNewestNoteTextarea } from './ui/notesPanel.js';
import {
  getWorkspaces, addWorkspace, removeWorkspace, getWorkspaceFile, resolveWorkspaceLink,
  workspaceSupportsWrite, getWorkspaceDirHandle, addFileToWorkspace, removeFileFromWorkspace,
} from './state/workspace.js';
import { renderSidebar } from './ui/sidebar.js';
import {
  renderWorkspacesPanel, forgetWorkspaceCollapsed,
} from './ui/filesPanel.js';
import { forgetWorkspaceViewState } from './ui/focalGraph.js';
import { renderBreadcrumb } from './ui/breadcrumb.js';
import { renderSectionView } from './ui/cardGrid.js';
import { renderFullDocView } from './ui/fullDocView.js';
import {
  recommendedMode, docModeKey, getStoredMode, setStoredMode,
} from './ui/docViewMode.js';
import { animatedSwap } from './ui/transitions.js';
import {
  readFile, openFilePicker, writeToHandle, downloadText, supportsFileSystemAccess,
} from './core/fileIO.js';
import {
  supportsDirectoryPicker, openDirectoryPicker, workspaceFromFileList, readWorkspaceFileText,
  createFileInDirectory, uniqueFileNameIn, deleteFileFromDirectory, reopenWorkspaceAtPath,
} from './core/workspaceIO.js';
import { isElectron } from './core/electronFsAdapter.js';
import { showToast } from './ui/toast.js';
import { openSettingsPanel } from './ui/settingsPanel.js';
import { openSourcePanel } from './ui/sourcePanel.js';
import { openShortcutsPanel } from './ui/shortcutsPanel.js';
import { showContextMenu } from './ui/contextMenu.js';
import { openNewFileModal, closeNewFileModal } from './ui/newFileModal.js';
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
} from './core/recovery.js';
import { getTheme, applyTheme } from './utils/theme.js';

// Belt-and-suspenders: index.html already stamps this inline (synchronously,
// before first paint, to avoid a light-then-dark flash) — this just keeps
// the module in sync with whatever was actually applied.
applyTheme(getTheme());

const el = {
  appBody: document.getElementById('app-body'),
  sidebar: document.getElementById('sidebar'),
  explorerSection: document.getElementById('explorer-section'),
  explorerToggle: document.getElementById('explorer-toggle'),
  workspaceTree: document.getElementById('workspace-tree'),
  sidebarResizeHandle: document.getElementById('sidebar-resize-handle'),
  outlineSection: document.getElementById('outline-section'),
  outlineToggle: document.getElementById('outline-toggle'),
  headingTree: document.getElementById('heading-tree'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  breadcrumb: document.getElementById('breadcrumb-bar'),
  viewModeBar: document.getElementById('view-mode-bar'),
  viewModeFullBtn: document.getElementById('view-mode-full-btn'),
  viewModeSectionsBtn: document.getElementById('view-mode-sections-btn'),
  sectionViewWrap: document.getElementById('section-view-wrap'),
  sectionView: document.getElementById('section-view'),
  emptyState: document.getElementById('empty-state'),
  fileInput: document.getElementById('file-input'),
  openFileBtn: document.getElementById('open-file-btn'),
  folderInput: document.getElementById('folder-input'),
  openFolderBtn: document.getElementById('open-folder-btn'),
  addFileBtn: document.getElementById('add-file-btn'),
  addSectionBtn: document.getElementById('add-section-btn'),
  mapViewBtn: document.getElementById('map-view-btn'),
  previewToggleBtn: document.getElementById('preview-edge-toggle'),
  previewPanel: document.getElementById('preview-panel'),
  previewResizeHandle: document.getElementById('preview-resize-handle'),
  saveBtn: document.getElementById('save-btn'),
  changesBtn: document.getElementById('changes-btn'),
  changesBadge: document.getElementById('changes-badge'),
  sourceBtn: document.getElementById('source-btn'),
  shortcutsBtn: document.getElementById('shortcuts-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  dirtyIndicator: document.getElementById('dirty-indicator'),
  dirtyText: document.getElementById('dirty-text'),
};

// Preview defaults to open (every newly-selected section previews live
// alongside it) rather than starting collapsed every session — see
// ui/previewPanel.js's getPreviewOpen/setPreviewOpen and the edge-toggle
// wiring below, which persists it once the user actually flips it.
el.previewPanel.hidden = !getPreviewOpen();

/**
 * The desktop app's own last-opened folder (see handleWorkspaceOpened and
 * the startup reopen below) — meaningless in the browser, where there's no
 * such thing as a path that survives the tab closing. Reopening it
 * silently on launch, the way VSCode reopens your last workspace, is the
 * whole point of moving off the browser's "grant access, once" model.
 */
const LAST_ELECTRON_FOLDER_KEY = 'mdDashboard.lastElectronFolder';

function rememberElectronFolder(rootPath, rootName) {
  try { localStorage.setItem(LAST_ELECTRON_FOLDER_KEY, JSON.stringify({ rootPath, rootName })); } catch { /* ignore */ }
}

function getRememberedElectronFolder() {
  try {
    const raw = localStorage.getItem(LAST_ELECTRON_FOLDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Which of the two fixed sidebar sections (Explorer, Outline — see
 * renderInner) are collapsed, a standing per-section preference rather
 * than a per-session toggle, keyed by a short id ('explorer' | 'outline').
 */
const SIDEBAR_SECTIONS_KEY = 'mdDashboard.sidebarSectionsCollapsed';

function isSidebarSectionCollapsed(key) {
  try {
    return JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) || '{}')[key] === true;
  } catch {
    return false;
  }
}

function toggleSidebarSection(key) {
  let all;
  try {
    all = JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) || '{}');
  } catch {
    all = {};
  }
  all[key] = !all[key];
  try { localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  render();
}

el.explorerToggle.addEventListener('click', () => toggleSidebarSection('explorer'));
el.outlineToggle.addEventListener('click', () => toggleSidebarSection('outline'));

let lastPathLength = 0;

// `currentBaseline` holds whichever file's content is currently active as
// it was when this editing session of it began (set in loadFromText and
// after a save) — the recovery snapshot's `baselineMarkdown`, shown in the
// recovery panel, so a restore prompt can be honest that a snapshot
// doesn't know about edits made outside the app since.
let currentBaseline = null;
// Files opened via the real file picker (not the <input type=file>
// fallback, which never grants a File System Access handle at all) keep
// their handle here by name, even after switching away — a workspace
// file's own handle is always available again later via getWorkspaceFile(),
// but a standalone file has nowhere else to keep it, and without this,
// switching back to one that still has pending edits (see loadFromText)
// would lose direct Save and fall back to a download every time.
const standaloneHandles = new Map();
// Every standalone file considered "open" this session — regardless of
// whether it's ever been edited — so Explorer's "Open files" group (see
// renderExplorerStandaloneEntries) behaves like VSCode's Open Editors: a
// loose file you switched away from stays listed and one click away, not
// just while it happens to have unsaved changes. Insertion order is
// most-recent-last (re-added via delete+add on every open, so switching
// back to an already-open one bumps it instead of leaving it stuck at its
// original position); rendered most-recent-first. Read by renderInner (via
// renderExplorerStandaloneEntries) on every render, including the very
// first one — declared here, before that first render() call below, so
// referencing it can't ever hit the temporal dead zone a `const` further
// down in this file would.
const openStandaloneFileNames = new Set();
// Every open standalone file's own last-known clean (saved/on-disk)
// content, by fileName — the fallback for switching back to one that has
// no pending recovery snapshot (nothing edited since) AND no live handle
// to re-read from disk (a file opened through the <input type=file>
// fallback never grants one at all, and this is Firefox's *only* path —
// it doesn't support the File System Access API showOpenFilePicker() relies
// on). Without this, reopening such a file after switching away had no
// route back to its content whatsoever: reopenCleanStandaloneFile() could
// only fail outright, showing an error and removing it from
// openStandaloneFileNames — which looked exactly like it had silently
// "disappeared," when nothing was actually lost. Updated on every fresh
// load and every save.
const standaloneCleanText = new Map();

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
  const {
    doc, fileName, dirty, workspaceRelPath, workspaceRootName,
  } = getState();

  updateChangesBadge();

  // VSCode-style, fixed two-pane sidebar: Explorer (every open
  // directory/standalone file, always fully shown — see
  // renderExplorer below) stays on top, Outline (the active document's own
  // heading breakdown) stays below, neither ever reordering or hiding
  // itself based on which file happens to be active.
  const workspaces = getWorkspaces();
  el.sidebar.classList.toggle('sidebar-graph-mode', workspaces.length > 0);
  const explorerCollapsed = isSidebarSectionCollapsed('explorer');
  const outlineCollapsed = isSidebarSectionCollapsed('outline');
  el.explorerSection.classList.toggle('sidebar-section-collapsed', explorerCollapsed);
  el.outlineSection.classList.toggle('sidebar-section-collapsed', outlineCollapsed);
  // Nothing to split while either side is folded down to just its header.
  el.sidebarResizeHandle.hidden = explorerCollapsed || outlineCollapsed;
  renderWorkspacesPanel(el.workspaceTree, workspaces, workspaceRootName, workspaceRelPath, {
    onOpenFile: openWorkspaceFile,
    onClose: handleCloseWorkspace,
    pendingPathsFor: pendingWorkspacePaths,
    onContextMenu: openExplorerContextMenu,
  });
  renderExplorerStandaloneEntries();
  if (!el.workspaceTree.hasChildNodes()) {
    el.workspaceTree.appendChild(h('p', { class: 'sidebar-empty' }, 'No folder or file opened yet.'));
  }
  el.openFolderBtn.textContent = workspaces.length ? '📁 Add folder' : '📁 Open folder';

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
  el.previewResizeHandle.hidden = el.previewPanel.hidden;

  if (!doc) {
    el.emptyState.hidden = false;
    el.sectionView.hidden = true;
    el.viewModeBar.hidden = true;
    renderSidebar(el.headingTree, null, [], selectSection, handleSidebarMove);
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

  // The user's own remembered choice for this exact document wins;
  // failing that, its length/structure recommends one (see
  // docViewMode.js) — a short document, or one with zero/one heading,
  // reads better as one continuous page than fragmented into a handful of
  // near-empty cards. Sections stays available either way (not just for
  // documents "big enough" to need it): notes, "Understand & suggest",
  // and title editing are still Sections-only, so it needs to stay
  // reachable even for a trivial one-heading document.
  const modeKey = docModeKey({ workspaceRootName, workspaceRelPath, fileName });
  const viewMode = getStoredMode(modeKey) || recommendedMode(doc);
  el.viewModeBar.hidden = false;
  el.viewModeFullBtn.setAttribute('aria-selected', String(viewMode === 'full'));
  el.viewModeSectionsBtn.setAttribute('aria-selected', String(viewMode === 'sections'));

  const direction = path.length >= lastPathLength ? 'forward' : 'back';
  lastPathLength = path.length;
  if (viewMode === 'full') {
    animatedSwap(el.sectionView, (container) => renderFullDocView(container, doc, fileName), direction);
  } else {
    animatedSwap(el.sectionView, (container) => renderSectionView(container, node, handleNavigateFile), direction);
  }
}

function handleViewModeChange(mode) {
  const { doc, fileName, workspaceRelPath, workspaceRootName } = getState();
  if (!doc) return;
  setStoredMode(docModeKey({ workspaceRootName, workspaceRelPath, fileName }), mode);
  render();
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
// save, the next load offers to restore any of them (currentBaseline,
// standaloneHandles, and openStandaloneFileNames are all declared earlier
// in this file, before the first render() call — see there).

/** The actual snapshot-writing logic, callable directly (bypassing the debounce below) when something needs the current dirty state captured *right now* — see handleChangesOpenSnapshot, which relies on this to make switching files from the Changes panel non-destructive without needing a confirm prompt. */
function snapshotNow() {
  const {
    doc, fileName, dirty, workspaceRelPath, workspaceRootName,
  } = getState();
  if (!doc || !dirty) return;
  const identity = { fileName, workspaceRelPath, workspaceRootName };
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

/**
 * How many sections the ACTIVE document's own dirty edit represents, but
 * ONLY when it hasn't been flushed to a real recovery snapshot yet
 * (otherwise it's already counted via the normal listRecoverySnapshots()
 * sum) — the periodic debounce (snapshotIfDirty) usually closes this gap
 * within 1.5s, but restoring a pending file as active (loadSnapshotAsActive)
 * clears its snapshot the instant it's restored, and freshly typing into a
 * brand-new edit hasn't been flushed even once yet — both leave a real
 * window where the badge would otherwise undercount.
 */
function activeGapChangedCount() {
  const {
    doc, dirty, fileName, workspaceRelPath, workspaceRootName,
  } = getState();
  if (!doc || !dirty || !currentBaseline) return 0;
  const id = snapshotIdentity({ fileName, workspaceRelPath, workspaceRootName });
  if (listRecoverySnapshots().some((s) => s.id === id)) return 0;
  try {
    return findChangedNodes(doc, parseMarkdown(currentBaseline)).length || 1;
  } catch {
    return 1;
  }
}

/**
 * Same gap as activeGapChangedCount() above, but as a snapshot-shaped entry
 * for the Changes panel's own row list rather than just a count —
 * enrichActiveSnapshot() fills in the real live doc and diff, so this only
 * needs to carry identity fields.
 */
function activeGapSnapshot() {
  const {
    doc, dirty, fileName, workspaceRelPath, workspaceRootName,
  } = getState();
  if (!doc || !dirty) return null;
  const id = snapshotIdentity({ fileName, workspaceRelPath, workspaceRootName });
  if (listRecoverySnapshots().some((s) => s.id === id)) return null;
  return {
    id, fileName, workspaceRelPath, workspaceRootName, savedAt: Date.now(), markdown: '',
  };
}

/** The badge (and the Changes panel's own subtitle) count individual changed *sections* across every pending file, not just how many files have any changes — editing two different sections of the same file is two changes, not one. */
function updateChangesBadge() {
  const pendingCount = listRecoverySnapshots().reduce((sum, snap) => sum + countChangedSections(snap), 0) + activeGapChangedCount();
  el.changesBadge.hidden = pendingCount === 0;
  el.changesBadge.textContent = String(pendingCount);
}

/** Every relPath within `workspace` that currently has a pending recovery snapshot — for the sidebar tree/graph's own small pending-changes dot (see filesPanel.js/focalGraph.js), so switching freely between files (nothing is ever discarded now) still leaves a visible trail of what's been touched. */
function pendingWorkspacePaths(workspace) {
  if (!workspace) return new Set();
  return new Set(
    listRecoverySnapshots()
      .filter((s) => s.workspaceRelPath && s.workspaceRootName === workspace.rootName)
      .map((s) => s.workspaceRelPath),
  );
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

/** A live handle for `snapshot`'s own file, when one's resolvable — a workspace file's is always available again via getWorkspaceFile(); a standalone file's only if it was opened this session through the real file picker (see standaloneHandles). Used so restoring a pending edit (loadSnapshotAsActive) can still Save directly instead of falling back to a download. */
function resolveHandleFor(snapshot) {
  if (snapshot.workspaceRelPath) return getWorkspaceFile(snapshot.workspaceRootName, snapshot.workspaceRelPath)?.fileHandle || null;
  return standaloneHandles.get(snapshot.fileName) || null;
}

/**
 * Every entry point that loads a document — samples, "Open .md file",
 * drag-drop, a workspace file, following a cross-file link — funnels
 * through here. Switching files never loses anything: whatever's currently
 * active gets force-flushed into its own recovery snapshot first if it's
 * dirty (snapshotNow() — the same non-destructive pattern the Changes
 * panel's own "Open" action already used, just applied everywhere now
 * rather than only there), and if the file being switched *to* already has
 * pending unsaved edits waiting, those are what gets shown instead of a
 * fresh — and by now stale — read of what's on disk (see
 * loadSnapshotAsActive). `workspaceRelPath`/`workspaceRootName` record
 * which open workspace file this is (both null for a standalone
 * file/sample), and `anchor` — a heading slug — jumps straight to that
 * section once loaded, for a cross-file link like
 * `[...](other.md#some-heading)`.
 */
async function loadFromText(text, fileName, fileHandle = null, { workspaceRelPath = null, workspaceRootName = null, anchor = null } = {}) {
  const current = getState();
  const targetIdentity = { fileName, workspaceRelPath, workspaceRootName };

  if (!workspaceRelPath) {
    // Bumped to "most recent" on every open, including re-opening one
    // that's already tracked — see openStandaloneFileNames above.
    openStandaloneFileNames.delete(fileName);
    openStandaloneFileNames.add(fileName);
  }

  if (current.doc) {
    const currentIdentity = {
      fileName: current.fileName, workspaceRelPath: current.workspaceRelPath, workspaceRootName: current.workspaceRootName,
    };
    if (snapshotIdentity(currentIdentity) === snapshotIdentity(targetIdentity)) {
      // Already the active document (e.g. re-clicking its own row, or a
      // cross-file link back to the same file with a different anchor) —
      // nothing to switch, just honor the anchor if one was given.
      if (anchor) {
        const targetId = buildSlugIndex(current.doc).get(anchor);
        if (targetId) selectSection(targetId);
      }
      return;
    }
  }
  snapshotNow();

  const pending = listRecoverySnapshots().find((s) => s.id === snapshotIdentity(targetIdentity));
  if (pending) {
    loadSnapshotAsActive(pending, { anchor, fileHandle: fileHandle || resolveHandleFor(pending) });
    return;
  }

  try {
    const doc = parseMarkdown(text);
    if (!doc.children.length && !doc.bodyMarkdown.trim()) {
      showToast('That file has no headings or content — nothing to show.', { type: 'error' });
      return;
    }
    currentBaseline = text;
    if (!workspaceRelPath) standaloneCleanText.set(fileName, text);
    loadDocument({
      doc, fileName, fileHandle, workspaceRelPath, workspaceRootName,
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

/** Read one file from the `rootName` workspace and load it as the active document (still funneling through loadFromText, which prefers a pending snapshot over this fresh read if one exists — see there). */
async function openWorkspaceFile(rootName, relPath, anchor = null) {
  const entry = getWorkspaceFile(rootName, relPath);
  if (!entry) {
    showToast(`"${relPath}" isn't in that open folder.`, { type: 'error' });
    return;
  }
  try {
    const text = await readWorkspaceFileText(entry);
    loadFromText(text, entry.name, entry.fileHandle, { workspaceRelPath: relPath, workspaceRootName: rootName, anchor });
  } catch (err) {
    showToast(`Could not open ${entry.name}: ${err.message}`, { type: 'error' });
  }
}

/**
 * enhanceRenderedContent (markdown/render.js) calls this for any rendered
 * link that isn't a same-page "#anchor" jump; it resolves relative to
 * whichever workspace file is currently open, and returns whether it
 * actually handled it (a link to some other page entirely — an external
 * URL, a .md file outside this folder, or one in a *different* open
 * folder — is left to behave normally).
 */
function handleNavigateFile(href) {
  const { workspaceRelPath, workspaceRootName } = getState();
  if (!workspaceRelPath) return false;
  const resolved = resolveWorkspaceLink(workspaceRootName, workspaceRelPath, href);
  if (!resolved) return false;
  openWorkspaceFile(workspaceRootName, resolved.relPath, resolved.anchor);
  return true;
}

/**
 * Closing one folder from the sidebar previously only ever forgot the
 * workspace itself — if the currently active document happened to be one
 * of its files, it stayed fully loaded and editable with no visible link
 * back to any folder at all, and with no warning even if it had unsaved
 * changes. Now closing a folder closes that document too (confirming
 * first if it's dirty, same as every other path that can actually lose
 * unsaved work) — a document that isn't part of THIS workspace (a
 * standalone file, or one from a *different* still-open folder) is left
 * alone, and so is every other open workspace.
 */
async function handleCloseWorkspace(rootName) {
  const {
    doc, dirty, workspaceRelPath, workspaceRootName, fileName,
  } = getState();
  if (doc && workspaceRelPath && workspaceRootName === rootName) {
    if (dirty) {
      const ok = await confirmDialog({
        title: 'Close this folder?',
        message: `"${fileName}" is open from this folder and has unsaved changes that will be lost. Close the folder anyway?`,
        confirmLabel: 'Close & discard',
        danger: true,
      });
      if (!ok) return;
    }
    clearRecoverySnapshot({ fileName, workspaceRelPath, workspaceRootName });
    currentBaseline = null;
    setState({
      doc: null, fileName: null, fileHandle: null, selectedId: null, dirty: false, workspaceRelPath: null, workspaceRootName: null,
    });
  }
  removeWorkspace(rootName);
  forgetWorkspaceViewState(rootName);
  forgetWorkspaceCollapsed(rootName);
  // Closing means closing: don't silently bring it back on the next launch
  // (see reopenLastElectronFolder above) just because it was the most
  // recently opened one.
  if (isElectron && getRememberedElectronFolder()?.rootName === rootName) {
    try { localStorage.removeItem(LAST_ELECTRON_FOLDER_KEY); } catch { /* ignore */ }
  }
  render();
}

function parentDirOf(relPath) {
  const i = relPath.lastIndexOf('/');
  return i === -1 ? '' : relPath.slice(0, i);
}

function stemOf(fileName) {
  return fileName.replace(/\.(md|markdown)$/i, '');
}

/**
 * Creates a brand-new file — from the sidebar's "File+" button (any
 * write-capable open workspace, or a blank standalone document if none is
 * open) or the Explorer's own "Add file" context-menu action (always a
 * specific folder, so its own call skips newFileModal's target picker
 * entirely). `target` is `{ rootName, dirRelPath }`, or the sentinel
 * string '__standalone__' for the blank-document fallback. Starts with a
 * single "# <name>" heading rather than genuinely empty content, since
 * loadFromText refuses to open a file with neither headings nor body text.
 */
async function handleCreateFile(fileName, target) {
  const initialText = `# ${stemOf(fileName)}\n`;
  if (!target || target === '__standalone__') {
    closeNewFileModal();
    loadFromText(initialText, fileName);
    return;
  }
  const { rootName, dirRelPath } = target;
  const dirHandle = getWorkspaceDirHandle(rootName, dirRelPath);
  if (!dirHandle) { showToast('That folder no longer supports creating files.', { type: 'error' }); return; }
  const relPath = dirRelPath ? `${dirRelPath}/${fileName}` : fileName;
  try {
    const fileHandle = await createFileInDirectory(dirHandle, fileName, initialText);
    addFileToWorkspace(rootName, {
      relPath, name: fileName, fileHandle, webkitFile: null,
    });
    closeNewFileModal();
    loadFromText(initialText, fileName, fileHandle, { workspaceRelPath: relPath, workspaceRootName: rootName });
  } catch (err) {
    showToast(`Could not create "${fileName}": ${err.message}`, { type: 'error' });
  }
}

function handleAddFileClick() {
  const targets = getWorkspaces()
    .filter((w) => workspaceSupportsWrite(w.rootName))
    .map((w) => ({ label: w.rootName, value: { rootName: w.rootName, dirRelPath: '' } }));
  targets.push({ label: 'a new blank standalone document (not saved to disk yet)', value: '__standalone__' });
  openNewFileModal({ targets, onCreate: handleCreateFile });
}

/** Opening a file from a right-click "Add section" switches to it first (if it isn't already active) so the modal that follows targets the right document, exactly the way clicking it in the tree would. */
async function handleAddSectionForFile(rootName, relPath) {
  const current = getState();
  if (current.workspaceRootName !== rootName || current.workspaceRelPath !== relPath) {
    await openWorkspaceFile(rootName, relPath);
  }
  openAddSectionModal();
}

/** The Explorer's own single-slot "clipboard" for Copy/Paste — deliberately in-memory only (not the OS clipboard, which has no sane way to carry a filename alongside its content); gone once the tab closes. */
let fileClipboard = null;

async function handleCopyFile(rootName, relPath, name) {
  const entry = getWorkspaceFile(rootName, relPath);
  if (!entry) return;
  try {
    const text = await readWorkspaceFileText(entry);
    fileClipboard = { name, text };
    showToast(`Copied "${name}" — right-click a folder (or this file) to Paste.`);
  } catch (err) {
    showToast(`Could not copy "${name}": ${err.message}`, { type: 'error' });
  }
}

async function handlePasteInto(rootName, dirRelPath) {
  if (!fileClipboard) return;
  const dirHandle = getWorkspaceDirHandle(rootName, dirRelPath);
  if (!dirHandle) { showToast('That folder no longer supports pasting files.', { type: 'error' }); return; }
  try {
    const name = await uniqueFileNameIn(dirHandle, fileClipboard.name);
    const fileHandle = await createFileInDirectory(dirHandle, name, fileClipboard.text);
    const relPath = dirRelPath ? `${dirRelPath}/${name}` : name;
    addFileToWorkspace(rootName, {
      relPath, name, fileHandle, webkitFile: null,
    });
    render();
    showToast(`Pasted as "${name}"`);
  } catch (err) {
    showToast(`Could not paste: ${err.message}`, { type: 'error' });
  }
}

/** Deletes a file from disk, permanently — the sidebar's own confirmation step (see openExplorerContextMenu) is the only guard against a misclick, so this itself never asks again. Clears the active document if it was the one just deleted, the same as closing the workspace it belonged to. */
async function handleDeleteFile(rootName, relPath, name) {
  const dirHandle = getWorkspaceDirHandle(rootName, parentDirOf(relPath));
  if (!dirHandle) { showToast('That folder no longer supports deleting files.', { type: 'error' }); return; }
  try {
    await deleteFileFromDirectory(dirHandle, name);
  } catch (err) {
    showToast(`Could not delete "${name}": ${err.message}`, { type: 'error' });
    return;
  }
  removeFileFromWorkspace(rootName, relPath);
  const current = getState();
  if (current.workspaceRootName === rootName && current.workspaceRelPath === relPath) {
    clearRecoverySnapshot({ fileName: current.fileName, workspaceRelPath: relPath, workspaceRootName: rootName });
    currentBaseline = null;
    setState({
      doc: null, fileName: null, fileHandle: null, selectedId: null, dirty: false, workspaceRelPath: null, workspaceRootName: null,
    });
  }
  render();
  showToast(`Deleted "${name}"`);
}

/**
 * The Explorer's right-click menu — Add section/Copy/Delete on a file row,
 * Add file/Paste on a directory row (including a workspace's own root —
 * see filesPanel.js). Delete/Copy/Paste/Add file are only meaningful for a
 * workspace opened via the native folder picker (see
 * workspaceSupportsWrite): the webkitdirectory fallback some browsers need
 * hands out plain File objects with no live handle to write through, so
 * those actions show disabled rather than silently failing. Folder rows
 * deliberately have no Delete of their own — deleting a whole directory
 * tree is a much larger blast radius than this menu is meant to risk.
 */
function openExplorerContextMenu(event, {
  rootName, relPath, isDir, name,
}) {
  const canWrite = workspaceSupportsWrite(rootName);
  const noWriteTitle = 'Only available for a folder opened via the native folder picker';

  if (isDir) {
    showContextMenu(event, [
      {
        label: '📄+ Add file here',
        disabled: !canWrite,
        title: canWrite ? '' : noWriteTitle,
        onClick: () => openNewFileModal({
          targets: [{ label: relPath ? `${rootName}/${relPath}` : rootName, value: { rootName, dirRelPath: relPath } }],
          onCreate: handleCreateFile,
        }),
      },
      {
        label: '📋 Paste',
        disabled: !canWrite || !fileClipboard,
        title: !canWrite ? noWriteTitle : (!fileClipboard ? 'Copy a file first' : ''),
        onClick: () => handlePasteInto(rootName, relPath),
      },
    ]);
    return;
  }

  showContextMenu(event, [
    { label: '+ Add section', onClick: () => handleAddSectionForFile(rootName, relPath) },
    'separator',
    {
      label: '📋 Copy',
      disabled: !canWrite,
      title: canWrite ? '' : noWriteTitle,
      onClick: () => handleCopyFile(rootName, relPath, name),
    },
    {
      label: '📋 Paste (alongside this file)',
      disabled: !canWrite || !fileClipboard,
      title: !canWrite ? noWriteTitle : (!fileClipboard ? 'Copy a file first' : ''),
      onClick: () => handlePasteInto(rootName, parentDirOf(relPath)),
    },
    'separator',
    {
      label: '🗑 Delete',
      danger: true,
      disabled: !canWrite,
      title: canWrite ? '' : noWriteTitle,
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Delete "${name}"?`,
          message: "This deletes the file from disk. This can't be undone.",
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) handleDeleteFile(rootName, relPath, name);
      },
    },
  ]);
}

/**
 * Every standalone file that's open this session (see
 * openStandaloneFileNames) gets its own small row in Explorer — the
 * currently active one, plus any *other* one navigated away from,
 * whether or not it has unsaved changes — the same way VSCode's Explorer
 * keeps a loose "open editor" listed until you explicitly close it, not
 * just while it happens to be dirty. Without this, a standalone file's
 * only trace once it stopped being the active document was the Changes
 * panel (and only then if it had unsaved edits) — switching to a
 * workspace made it look like it had vanished, even though it was still
 * one click away. A workspace file never needs this: it always has its
 * own permanent row in the tree/graph (with the same pending-changes dot)
 * regardless of which file is currently active.
 */
function renderExplorerStandaloneEntries() {
  const { doc, fileName, workspaceRelPath } = getState();
  const activeIsStandalone = Boolean(doc) && !workspaceRelPath;

  const rows = [];
  if (activeIsStandalone) {
    // Marked as the current one (same idea as a workspace file's own
    // .nav-link-current highlight) so it's unmistakable this row IS what's
    // already showing, not an inert or broken entry waiting to be clicked.
    rows.push(h('div', { class: 'files-tree-head standalone-file-head standalone-file-head-active' }, [
      h('span', { class: 'files-tree-icon' }, '📄'),
      h('span', { class: 'files-tree-name', title: fileName }, fileName),
      h('button', {
        class: 'icon-btn files-tree-close',
        type: 'button',
        title: 'Close this file',
        'aria-label': 'Close this file',
        onClick: handleCloseStandaloneFile,
      }, '✕'),
    ]));
  }

  // Most recently opened/switched-to first (see openStandaloneFileNames).
  const otherNames = [...openStandaloneFileNames]
    .filter((name) => !(activeIsStandalone && name === fileName))
    .reverse();
  otherNames.forEach((name) => {
    const snap = listRecoverySnapshots().find((s) => !s.workspaceRelPath && s.fileName === name);
    rows.push(h('div', { class: 'files-tree-head standalone-file-head standalone-file-head-pending' }, [
      h('button', {
        class: 'standalone-file-switch',
        type: 'button',
        title: snap ? `Switch to "${name}" — unsaved changes waiting` : `Switch to "${name}"`,
        onClick: () => (snap ? handleChangesOpenSnapshot(snap) : reopenCleanStandaloneFile(name)),
      }, [
        h('span', { class: 'files-tree-icon' }, '📄'),
        h('span', { class: 'files-tree-name' }, name),
        snap ? h('span', { class: 'nav-pending-dot' }) : null,
      ]),
      h('button', {
        class: 'icon-btn files-tree-close',
        type: 'button',
        title: snap ? 'Discard these changes and close' : 'Close this file',
        'aria-label': snap ? 'Discard these changes and close' : 'Close this file',
        onClick: () => {
          if (snap) handleChangesDiscard(snap, false);
          openStandaloneFileNames.delete(name);
          standaloneCleanText.delete(name);
          render();
        },
      }, '✕'),
    ]));
  });

  if (!rows.length) return;
  // Grouped under its own small label and kept visually separate from the
  // folder blocks below — otherwise a loose file's row and a workspace
  // folder's own header (both share the same "files-tree-head" look) read
  // as the same kind of thing stacked in one undifferentiated list, which
  // is what actually made a loose file opened alongside two folders look
  // like it had landed in the wrong place rather than its own distinct
  // "open files" area (VSCode's own Explorer keeps exactly this
  // distinction, via a separate "Open Editors" section above the tree).
  const group = h('div', { class: 'explorer-open-files' }, [
    getWorkspaces().length ? h('div', { class: 'explorer-open-files-label' }, 'Open files') : null,
    ...rows,
  ]);
  el.workspaceTree.prepend(group);
}

/** The ✕ on a standalone file's own sidebar header (see renderInner) — closes just that file, leaving an open workspace (if any) untouched, same confirm-if-dirty treatment as everything else that can discard unsaved work. */
async function handleCloseStandaloneFile() {
  const { dirty, fileName } = getState();
  if (dirty) {
    const ok = await confirmDialog({
      title: 'Close this file?',
      message: `"${fileName}" has unsaved changes that will be lost. Close it anyway?`,
      confirmLabel: 'Close & discard',
      danger: true,
    });
    if (!ok) return;
  }
  openStandaloneFileNames.delete(fileName);
  standaloneCleanText.delete(fileName);
  currentBaseline = null;
  setState({
    doc: null, fileName: null, fileHandle: null, selectedId: null, dirty: false, workspaceRelPath: null, workspaceRootName: null,
  });
}

/**
 * Switch back to a standalone file that's open (see
 * openStandaloneFileNames) but currently neither active nor dirty — there's
 * no recovery snapshot to restore (nothing to preserve). Prefers re-reading
 * it fresh from its retained file-picker handle, the same live-handle
 * guarantee a workspace file always has via getWorkspaceFile() — but a file
 * opened through the <input type=file> fallback never grants one at all
 * (Firefox's *only* path, since it doesn't support the File System Access
 * API showOpenFilePicker() relies on), so this falls back to its own
 * last-known clean content (standaloneCleanText) rather than failing
 * outright — which used to look exactly like the file had silently
 * vanished, when nothing was actually lost.
 */
async function reopenCleanStandaloneFile(fileName) {
  const handle = standaloneHandles.get(fileName);
  if (handle) {
    try {
      const file = await handle.getFile();
      const text = await file.text();
      loadFromText(text, fileName, handle);
      return;
    } catch (err) {
      showToast(`Could not re-read ${fileName} from disk (${err.message}) — showing its last-known content instead.`, { type: 'error' });
    }
  }
  const cached = standaloneCleanText.get(fileName);
  if (cached === undefined) {
    showToast(`Can't reopen "${fileName}" automatically — use "Open .md file" to pick it again.`, { type: 'error' });
    openStandaloneFileNames.delete(fileName);
    render();
    return;
  }
  loadFromText(cached, fileName, null);
}

/**
 * Add a newly-picked folder alongside whatever's already open — never
 * replaces another open workspace, so working across two (or more)
 * directories at once is just opening the folder picker again. Re-opening
 * an already-open folder refreshes its file list in place instead of
 * duplicating it (see addWorkspace).
 */
async function handleWorkspaceOpened({
  rootName, files, dirHandles = null, rootPath = null,
}) {
  if (isElectron && rootPath) rememberElectronFolder(rootPath, rootName);
  if (!files.length) {
    showToast(`No Markdown files found in "${rootName}".`, { type: 'error' });
    return;
  }
  addWorkspace({ rootName, files, dirHandles });
  showToast(`Opened "${rootName}" — ${files.length} Markdown file${files.length === 1 ? '' : 's'} found.`);
  // Only auto-open a default file when nothing at all is active yet: if
  // something's already open (a standalone file, or a file from a
  // previously-open folder), opening a new folder alongside it shouldn't
  // silently replace it — the folder becomes browsable in the sidebar and
  // the current document stays exactly where it was.
  if (getState().doc) {
    // addWorkspace() (state/workspace.js) is its own module state, not
    // part of the store — it never triggers a re-render on its own the
    // way setState() does, so without this the sidebar just wouldn't pick
    // up the newly-opened folder at all until some unrelated change
    // happened to re-render it.
    render();
    return;
  }
  const sorted = files.slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const preferred = sorted.find((f) => !f.relPath.includes('/') && /^(README|INDEX)\.(md|markdown)$/i.test(f.name));
  await openWorkspaceFile(rootName, (preferred || sorted[0]).relPath);
}

/**
 * Load a crash-recovery snapshot's content as the active document (dirty —
 * it was never actually saved). Used by the startup recovery flow, the
 * Changes panel's own "Open" action, and — every ordinary file switch that
 * lands on a file with pending unsaved edits (see loadFromText, which
 * prefers this over a fresh on-disk read so switching back to a file you
 * were mid-edit on shows that edit, not a stale copy). `fileHandle`, when
 * the caller can resolve one (see resolveHandleFor), keeps direct Save
 * working instead of falling back to a download; there's genuinely nothing
 * to resolve across a page reload, which is why the startup recovery
 * flow's own calls here always end up passing none.
 *
 * Reuses `snapshot.doc` when present (set by enrichSnapshot()) rather than
 * re-parsing `snapshot.markdown` here — parseMarkdown() hands out fresh ids
 * every call (see utils/id.js), so a *second* parse of the exact same text
 * produces a structurally-identical tree with completely different id
 * values; an id computed against an earlier parse (elsewhere, for the
 * Changes panel's own section list) would silently match nothing in a
 * freshly re-parsed one. Lands on `sectionId` if given (the Changes panel
 * jumping to one specific listed change), then `anchor` (a heading slug,
 * for a cross-file link into a file that turned out to have pending edits),
 * otherwise on whichever section was actually edited first (see
 * markdown/diff.js), not just wherever the document opens by default.
 */
function loadSnapshotAsActive(snapshot, { sectionId = null, anchor = null, fileHandle = null } = {}) {
  try {
    if (!snapshot.workspaceRelPath) {
      openStandaloneFileNames.delete(snapshot.fileName);
      openStandaloneFileNames.add(snapshot.fileName);
    }
    const doc = snapshot.doc ?? parseMarkdown(snapshot.markdown);
    currentBaseline = snapshot.baselineMarkdown ?? snapshot.markdown;
    loadDocument({
      doc,
      fileName: snapshot.fileName,
      fileHandle,
      dirty: true,
      workspaceRelPath: snapshot.workspaceRelPath,
      workspaceRootName: snapshot.workspaceRootName,
    });
    let targetId = sectionId;
    if (!targetId && anchor) {
      targetId = buildSlugIndex(doc).get(anchor) ?? null;
    }
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
      if (picked) {
        standaloneHandles.set(picked.fileName, picked.handle);
        loadFromText(picked.text, picked.fileName, picked.handle);
      }
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

/**
 * The one obvious way to persist changes: write straight back to the file
 * if it was opened via "Open .md file" (a real File System Access handle),
 * otherwise download the up-to-date Markdown. Either way counts as
 * "saved" — the in-memory doc is no longer ahead of what the user has.
 */
async function handleSave() {
  const {
    doc, fileName, fileHandle, workspaceRelPath, workspaceRootName,
  } = getState();
  if (!doc) return;
  const text = serializeMarkdown(doc);
  const identity = { fileName, workspaceRelPath, workspaceRootName };

  if (fileHandle) {
    try {
      await writeToHandle(fileHandle, text);
      setState({ dirty: false });
      clearRecoverySnapshot(identity);
      currentBaseline = text;
      if (!workspaceRelPath) standaloneCleanText.set(fileName, text);
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
  if (!workspaceRelPath) standaloneCleanText.set(fileName, text);
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
  const entry = snapshot.workspaceRelPath ? getWorkspaceFile(snapshot.workspaceRootName, snapshot.workspaceRelPath) : null;
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
  const entry = snapshot.workspaceRelPath ? getWorkspaceFile(snapshot.workspaceRootName, snapshot.workspaceRelPath) : null;
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
  loadSnapshotAsActive(snapshot, { fileHandle: resolveHandleFor(snapshot) });
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
    ? snapshotIdentity({ fileName: current.fileName, workspaceRelPath: current.workspaceRelPath, workspaceRootName: current.workspaceRootName })
    : null;
  if (snapshot.id === currentId) {
    selectSection(sectionId);
    return;
  }
  snapshotNow();
  loadSnapshotAsActive(snapshot, { sectionId, fileHandle: resolveHandleFor(snapshot) });
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
    const { fileHandle, workspaceRelPath, workspaceRootName } = getState();
    const doc = parseMarkdown(currentBaseline);
    loadDocument({
      doc, fileName: snapshot.fileName, fileHandle, dirty: false, workspaceRelPath, workspaceRootName,
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
  const {
    doc, fileName, workspaceRelPath, workspaceRootName,
  } = getState();
  const activeId = doc ? snapshotIdentity({ fileName, workspaceRelPath, workspaceRootName }) : null;
  const enriched = listRecoverySnapshots().map((snap) => (snap.id === activeId ? enrichActiveSnapshot(snap) : enrichSnapshot(snap)));
  const gap = activeGapSnapshot();
  if (gap) enriched.push(enrichActiveSnapshot(gap));
  openChangesPanel(enriched, activeId, changesPanelHandlers);
}

el.saveBtn.addEventListener('click', handleSave);
el.dirtyIndicator.addEventListener('click', handleSave);
el.changesBtn.addEventListener('click', handleOpenChanges);

el.viewModeFullBtn.addEventListener('click', () => handleViewModeChange('full'));
el.viewModeSectionsBtn.addEventListener('click', () => handleViewModeChange('sections'));

el.addFileBtn.addEventListener('click', handleAddFileClick);
el.addSectionBtn.addEventListener('click', openAddSectionModal);
el.mapViewBtn.addEventListener('click', () => {
  const workspaces = getWorkspaces();
  const { workspaceRootName } = getState();
  const workspace = workspaces.find((w) => w.rootName === workspaceRootName) || workspaces[0] || null;
  openMapView({ workspace, onOpenWorkspaceFile: openWorkspaceFile });
});
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
 * Add a note to whichever section is currently selected — the same action
 * a card's own "+ Add note" button performs, available globally via
 * Alt+N (see the keydown listener below) so it doesn't require scrolling
 * to that button first.
 */
function addNoteToSelected() {
  const node = getSelectedNode();
  if (!node) return;
  const countBefore = document.querySelectorAll('.notes-textarea').length;
  updateNode(node.id, { bodyMarkdown: addNote(node.bodyMarkdown) });
  focusNewestNoteTextarea(countBefore);
}

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'n' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const active = document.activeElement;
  // Never hijack Alt+N while the user is typing anywhere — a note field, a
  // section's content editor, a modal input, all of it.
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) return;
  if (!getState().doc) return;
  e.preventDefault();
  addNoteToSelected();
});

/**
 * Every other global shortcut (see ui/shortcutsPanel.js's SHORTCUTS table,
 * the guide's own single source of truth for this list) just clicks the
 * button it stands in for, so there's exactly one code path for each
 * action regardless of how it's triggered. Ctrl/⌘+S is the one exception
 * that works while typing (like any text editor's own save shortcut); the
 * Alt+letter ones and "?" are guarded the same way Alt+N already is above,
 * so they don't hijack an Alt-combo character or a literal "?" typed into
 * a note, a section's content, or a modal field.
 */
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if ((key === 's') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (getState().doc) handleSave();
    return;
  }

  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);

  if (e.key === '?' && !isTyping) {
    e.preventDefault();
    openShortcutsPanel();
    return;
  }

  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping) return;
  const altActions = {
    o: () => el.openFileBtn.click(),
    d: () => el.openFolderBtn.click(),
    f: () => el.addFileBtn.click(),
    a: () => { if (!el.addSectionBtn.disabled) el.addSectionBtn.click(); },
    c: () => el.changesBtn.click(),
    m: () => { if (!el.mapViewBtn.disabled) el.mapViewBtn.click(); },
    p: () => { if (!el.previewToggleBtn.disabled) el.previewToggleBtn.click(); },
    v: () => { if (!el.viewModeBar.hidden) handleViewModeChange(el.viewModeFullBtn.getAttribute('aria-selected') === 'true' ? 'sections' : 'full'); },
    r: () => { if (!el.sourceBtn.disabled) el.sourceBtn.click(); },
    ',': () => el.settingsBtn.click(),
  };
  const action = altActions[key];
  if (!action) return;
  e.preventDefault();
  action();
});

el.shortcutsBtn.addEventListener('click', openShortcutsPanel);

/**
 * Drag-to-resize for the preview panel, via the dedicated handle sitting
 * between the content pane and the preview (a real flex sibling, not
 * absolutely positioned — see its CSS). Width is stored as a CSS variable
 * on the root element (read by both #preview-panel and the edge-toggle's
 * own docked position) and persisted, so a chosen width survives reloads
 * the same way the other sidebar/preview display preferences do.
 */
const PREVIEW_WIDTH_KEY = 'mdDashboard.previewWidth';
const PREVIEW_WIDTH_MIN = 280;
const PREVIEW_WIDTH_MAX_VW = 0.7;

function applyPreviewWidth(px) {
  document.documentElement.style.setProperty('--preview-width', `${px}px`);
}

(function restorePreviewWidth() {
  const stored = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
  if (Number.isFinite(stored) && stored > 0) applyPreviewWidth(stored);
}());

let previewResizeStartX = null;
let previewResizeStartWidth = null;

el.previewResizeHandle.addEventListener('pointerdown', (e) => {
  previewResizeStartX = e.clientX;
  previewResizeStartWidth = el.previewPanel.getBoundingClientRect().width;
  el.previewResizeHandle.classList.add('preview-resize-active');
  el.previewResizeHandle.setPointerCapture(e.pointerId);
});
el.previewResizeHandle.addEventListener('pointermove', (e) => {
  if (previewResizeStartX === null) return;
  const maxWidth = window.innerWidth * PREVIEW_WIDTH_MAX_VW;
  const next = Math.min(maxWidth, Math.max(PREVIEW_WIDTH_MIN, previewResizeStartWidth - (e.clientX - previewResizeStartX)));
  applyPreviewWidth(next);
});
function endPreviewResize(e) {
  if (previewResizeStartX === null) return;
  previewResizeStartX = null;
  previewResizeStartWidth = null;
  el.previewResizeHandle.classList.remove('preview-resize-active');
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(Math.round(el.previewPanel.getBoundingClientRect().width)));
  } catch { /* ignore */ }
  if (e) {
    try { el.previewResizeHandle.releasePointerCapture(e.pointerId); } catch { /* already released, e.g. on pointercancel */ }
  }
}
el.previewResizeHandle.addEventListener('pointerup', endPreviewResize);
el.previewResizeHandle.addEventListener('pointercancel', endPreviewResize);

/**
 * Drag-to-resize for the split between Explorer and Outline, via the
 * dedicated handle between them (same real-flex-sibling approach as the
 * preview's own resize handle above). Explorer's share is a percentage of
 * the sidebar's own content height, stored as a CSS variable and
 * persisted — a percentage rather than a pixel width because the
 * sidebar's total height varies with the viewport, unlike the preview
 * panel's horizontal width.
 */
const SIDEBAR_SPLIT_KEY = 'mdDashboard.sidebarSplit';
const SIDEBAR_SPLIT_MIN_PCT = 0.15;
const SIDEBAR_SPLIT_MAX_PCT = 0.85;

function applySidebarSplit(pct) {
  document.documentElement.style.setProperty('--explorer-height', `${(pct * 100).toFixed(2)}%`);
}

(function restoreSidebarSplit() {
  const stored = Number(localStorage.getItem(SIDEBAR_SPLIT_KEY));
  if (Number.isFinite(stored) && stored > 0 && stored < 1) applySidebarSplit(stored);
}());

let sidebarResizeStartY = null;
let sidebarResizeStartExplorerHeight = null;
let sidebarResizeTotalHeight = null;

el.sidebarResizeHandle.addEventListener('pointerdown', (e) => {
  sidebarResizeStartY = e.clientY;
  sidebarResizeStartExplorerHeight = el.explorerSection.getBoundingClientRect().height;
  sidebarResizeTotalHeight = el.sidebar.getBoundingClientRect().height - el.sidebarResizeHandle.getBoundingClientRect().height;
  el.sidebarResizeHandle.classList.add('sidebar-resize-active');
  el.sidebarResizeHandle.setPointerCapture(e.pointerId);
});
el.sidebarResizeHandle.addEventListener('pointermove', (e) => {
  if (sidebarResizeStartY === null || !sidebarResizeTotalHeight) return;
  const nextHeight = sidebarResizeStartExplorerHeight + (e.clientY - sidebarResizeStartY);
  const pct = Math.min(SIDEBAR_SPLIT_MAX_PCT, Math.max(SIDEBAR_SPLIT_MIN_PCT, nextHeight / sidebarResizeTotalHeight));
  applySidebarSplit(pct);
});
function endSidebarResize(e) {
  if (sidebarResizeStartY === null) return;
  sidebarResizeStartY = null;
  sidebarResizeStartExplorerHeight = null;
  const total = sidebarResizeTotalHeight;
  sidebarResizeTotalHeight = null;
  el.sidebarResizeHandle.classList.remove('sidebar-resize-active');
  if (total) {
    try {
      localStorage.setItem(SIDEBAR_SPLIT_KEY, String(el.explorerSection.getBoundingClientRect().height / total));
    } catch { /* ignore */ }
  }
  if (e) {
    try { el.sidebarResizeHandle.releasePointerCapture(e.pointerId); } catch { /* already released, e.g. on pointercancel */ }
  }
}
el.sidebarResizeHandle.addEventListener('pointerup', endSidebarResize);
el.sidebarResizeHandle.addEventListener('pointercancel', endSidebarResize);

el.sourceBtn.addEventListener('click', openSourcePanel);
el.settingsBtn.addEventListener('click', openSettingsPanel);
el.sidebarToggle.addEventListener('click', () => {
  const isNarrowViewport = window.matchMedia('(max-width: 860px)').matches;
  el.sidebar.classList.toggle(isNarrowViewport ? 'sidebar-open' : 'sidebar-collapsed');
});

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

/**
 * Silently reopens the desktop app's last-used folder on launch — the
 * same trust VSCode extends to reopening your last workspace, made
 * possible by the desktop app keeping a real path (LAST_ELECTRON_FOLDER_KEY
 * above) rather than a browser permission grant that never survives a
 * reload anyway. Never runs in the browser; never blocks the rest of
 * startup if the folder's moved or been deleted since — just a toast, the
 * same failure path a manual re-open would hit.
 */
async function reopenLastElectronFolder() {
  if (!isElectron) return;
  const remembered = getRememberedElectronFolder();
  if (!remembered) return;
  try {
    const result = await reopenWorkspaceAtPath(remembered.rootPath, remembered.rootName);
    await handleWorkspaceOpened(result);
  } catch (err) {
    showToast(`Could not reopen "${remembered.rootName}": ${err.message}`, { type: 'error' });
  }
}
reopenLastElectronFolder();
