// Pure change-tracking logic split out of main.js (issue #29): which files and
// sections have unsaved edits, and how many. Everything here takes the app
// state, the active document's baseline and the pending recovery snapshots as
// arguments instead of reading module-level globals, so it can be exercised
// directly in tests. main.js keeps same-named wrappers that supply them.
import { parseMarkdown } from '../markdown/parser.js';
import { findChangedNodes, tagsDiffer } from '../markdown/diff.js';
import { snapshotIdentity } from './recovery.js';

const identityOf = (s) => snapshotIdentity({
  fileName: s.fileName, workspaceRelPath: s.workspaceRelPath, workspaceRootName: s.workspaceRootName,
});

/**
 * The sections a snapshot actually touched vs its own baseline. `null` (not
 * an empty array) when there's no baseline to compare against or a parse
 * fails — a real diff can legitimately be empty (every edit undone), and that
 * must stay distinguishable from "couldn't tell".
 */
export function diffSnapshot(snap) {
  if (!snap.baselineMarkdown) return null;
  try {
    const doc = parseMarkdown(snap.markdown);
    const baselineDoc = parseMarkdown(snap.baselineMarkdown);
    return { sections: findChangedNodes(doc, baselineDoc), tagsChanged: tagsDiffer(doc, baselineDoc) };
  } catch {
    return null;
  }
}

/** Sections (not files) a snapshot represents, plus one if its tags changed; 1 as a fallback only for an undiffable snapshot. */
export function countChangedSections(snap) {
  const diff = diffSnapshot(snap);
  if (diff === null) return 1;
  return diff.sections.length + (diff.tagsChanged ? 1 : 0);
}

/** Sections the ACTIVE document's dirty edit represents, only while it hasn't been flushed to a snapshot yet (otherwise it is counted via the snapshot list). */
export function activeGapChangedCount(state, baseline, snapshots) {
  const { doc, dirty } = state;
  if (!doc || !dirty || !baseline) return 0;
  if (snapshots.some((s) => s.id === identityOf(state))) return 0;
  try {
    const baselineDoc = parseMarkdown(baseline);
    const sectionCount = findChangedNodes(doc, baselineDoc).length;
    const tagCount = tagsDiffer(doc, baselineDoc) ? 1 : 0;
    // `|| 1`: a dirty edit neither check accounts for (e.g. a title-only
    // rename) still beats reporting 0.
    return sectionCount + tagCount || 1;
  } catch {
    return 1;
  }
}

/** A snapshot-shaped row for the active document's un-flushed edit (identity fields only; enrichActiveSnapshot fills in the diff), or null. */
export function activeGapSnapshot(state, snapshots, now = Date.now()) {
  const {
    doc, dirty, fileName, workspaceRelPath, workspaceRootName,
  } = state;
  if (!doc || !dirty) return null;
  const id = identityOf(state);
  if (snapshots.some((s) => s.id === id)) return null;
  return {
    id, fileName, workspaceRelPath, workspaceRootName, savedAt: now, markdown: '',
  };
}

/** Every relPath in `workspace` with a pending snapshot. */
export function pendingWorkspacePaths(workspace, snapshots) {
  if (!workspace) return new Set();
  return new Set(
    snapshots
      .filter((s) => s.workspaceRelPath && s.workspaceRootName === workspace.rootName)
      .map((s) => s.workspaceRelPath),
  );
}

/** Whether ONE file (by identity, active or not) has unsaved edits: the live dirty flag if it is the active document, else whether it has a pending snapshot. */
export function isFileDirty(identity, state, snapshots) {
  const targetId = snapshotIdentity(identity);
  if (state.doc && identityOf(state) === targetId) return state.dirty;
  return snapshots.some((s) => s.id === targetId);
}

/** Whether ANYTHING open has unsaved changes, regardless of which file is selected. */
export function hasAnyUnsavedChanges(state, snapshots) {
  return Boolean(state.dirty) || snapshots.length > 0;
}

/** Attaches the snapshot's parsed `doc` and its individually-changed sections (null = couldn't determine). */
export function enrichSnapshot(snap) {
  try {
    const doc = parseMarkdown(snap.markdown);
    const baselineDoc = snap.baselineMarkdown ? parseMarkdown(snap.baselineMarkdown) : null;
    const changedSections = baselineDoc ? findChangedNodes(doc, baselineDoc) : null;
    const tagsChanged = baselineDoc ? tagsDiffer(doc, baselineDoc) : false;
    return {
      ...snap, doc, changedSections, tagsChanged,
    };
  } catch {
    return {
      ...snap, doc: null, changedSections: null, tagsChanged: false,
    };
  }
}

/** enrichSnapshot() for the row that is the live active document: diffed against the real in-memory doc so its section ids are the selectable ones. */
export function enrichActiveSnapshot(snap, liveDoc, baseline) {
  if (!liveDoc || !baseline) return enrichSnapshot(snap);
  try {
    const baselineDoc = parseMarkdown(baseline);
    return {
      ...snap, doc: liveDoc, changedSections: findChangedNodes(liveDoc, baselineDoc), tagsChanged: tagsDiffer(liveDoc, baselineDoc),
    };
  } catch {
    return enrichSnapshot(snap);
  }
}
