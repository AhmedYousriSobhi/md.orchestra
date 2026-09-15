// Crash-recovery snapshots: serialized Markdown for every file that had
// unsaved changes, stashed in localStorage, so a crashed tab or an
// accidentally-closed window doesn't lose work — the next load offers to
// restore any of them. This is a local safety net, not a save: an entry is
// cleared the moment its file is actually saved, or the user discards it.
//
// Previously this kept only the single most-recently-edited file, silently
// overwriting the slot on every autosave tick — editing a second file lost
// any pending recovery for the first, and the flow was one blind
// window.confirm() with no way to see what you'd actually be restoring.
// Now every distinct file gets its own entry (keyed below), all of them are
// shown together, and each also records `baselineMarkdown` — the file's
// content as it was when this session of editing it began — so the restore
// UI can be honest about what it does and doesn't know: it has no way to
// re-check a file that's been edited outside the app since (the browser
// doesn't persist a read handle across reloads), but showing the saved
// timestamp and the pre-edit baseline lets the user judge that for
// themselves instead of the app silently assuming its cached copy still
// reflects reality.
const KEY = 'mdDashboard.recovery.v2';
const MAX_SNAPSHOTS = 20;

function identityFor({ fileName, workspaceRelPath, workspaceRootName }) {
  return workspaceRelPath ? `ws::${workspaceRootName || ''}::${workspaceRelPath}` : `file::${fileName}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_SNAPSHOTS)));
  } catch {
    // localStorage full/unavailable (private browsing, quota) — recovery is best-effort only.
  }
}

/** Record (or replace) the pending snapshot for one file. Call with a stable `baselineMarkdown` (the content this editing session started from) every time — only the latest edit needs saving, but the original baseline has to survive every update to stay meaningful. */
export function saveRecoverySnapshot({
  fileName, workspaceRelPath = null, workspaceRootName = null, markdown, baselineMarkdown,
}) {
  const id = identityFor({ fileName, workspaceRelPath, workspaceRootName });
  const list = readAll().filter((s) => s.id !== id);
  list.push({
    id,
    fileName,
    workspaceRelPath,
    workspaceRootName,
    markdown,
    baselineMarkdown,
    savedAt: Date.now(),
  });
  writeAll(list);
}

/** Every pending snapshot, most recently saved first. */
export function listRecoverySnapshots() {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function clearRecoverySnapshot({ fileName, workspaceRelPath = null, workspaceRootName = null }) {
  const id = identityFor({ fileName, workspaceRelPath, workspaceRootName });
  writeAll(readAll().filter((s) => s.id !== id));
}

export function clearAllRecoverySnapshots() {
  writeAll([]);
}
