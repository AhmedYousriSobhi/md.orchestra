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
// Storage layout (v3): one localStorage entry per document, keyed
// `mdDashboard.recovery.v3:<identity>`, so an autosave tick rewrites only the
// document that changed instead of re-serializing every pending snapshot.
// v2 stored the whole list as one JSON array under LEGACY_KEY; it is migrated
// on first read. The cache is bounded by entry count *and* total characters,
// evicting the oldest other entries first, and a write that cannot be stored
// at all is reported to the caller (saveRecoverySnapshot returns false)
// instead of silently dropping the very edit it exists to protect.
const LEGACY_KEY = 'mdDashboard.recovery.v2';
const PREFIX = 'mdDashboard.recovery.v3:';
const MAX_SNAPSHOTS = 20;
const MAX_TOTAL_CHARS = 2_000_000;

function identityFor({ fileName, workspaceRelPath, workspaceRootName }) {
  return workspaceRelPath ? `ws::${workspaceRootName || ''}::${workspaceRelPath}` : `file::${fileName}`;
}

/** The same identity a snapshot is keyed/looked up by — exported so callers (e.g. the Changes panel) can tell whether a given snapshot corresponds to the currently active document without duplicating this logic. */
export function snapshotIdentity(info) {
  return identityFor(info);
}

const isEntry = (s) => s && typeof s === 'object' && typeof s.id === 'string';

function migrateLegacy() {
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
  if (raw === null) return;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      list.filter(isEntry).forEach((entry) => {
        try { localStorage.setItem(PREFIX + entry.id, JSON.stringify(entry)); } catch { /* best effort */ }
      });
    }
  } catch { /* malformed legacy blob: drop it */ }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

/**
 * Every well-formed stored entry. Malformed values (a stray write from an
 * older version, or something unrelated) are skipped rather than allowed to
 * throw at startup, before this app's own handlers are even wired up.
 */
function readAll() {
  const out = [];
  try {
    migrateLegacy();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (isEntry(entry)) out.push(entry);
      } catch { /* skip corrupt entry */ }
    }
  } catch { /* localStorage unavailable */ }
  return out;
}

function removeEntry(id) {
  try { localStorage.removeItem(PREFIX + id); } catch { /* ignore */ }
}

/** Drop oldest entries other than `keepId` until count and size budgets hold. Returns how many were evicted. */
function enforceBudget(keepId) {
  let evicted = 0;
  const others = readAll().filter((e) => e.id !== keepId).sort((a, b) => a.savedAt - b.savedAt);
  const sizeOf = (e) => (e.markdown?.length || 0) + (e.baselineMarkdown?.length || 0);
  const kept = readAll().find((e) => e.id === keepId);
  let total = others.reduce((n, e) => n + sizeOf(e), 0) + (kept ? sizeOf(kept) : 0);
  let count = others.length + (kept ? 1 : 0);
  while (others.length && (count > MAX_SNAPSHOTS || total > MAX_TOTAL_CHARS)) {
    const oldest = others.shift();
    removeEntry(oldest.id);
    total -= sizeOf(oldest);
    count -= 1;
    evicted += 1;
  }
  return evicted;
}

/**
 * Record (or replace) the pending snapshot for one file. Call with a stable `baselineMarkdown` (the content this editing session started from) every time — only the latest edit needs saving, but the original baseline has to survive every update to stay meaningful.
 *
 * Returns true if the snapshot is stored. On a quota error it evicts the oldest *other* snapshots one at a time and retries; false means even that wasn't enough (this one snapshot alone exceeds what the browser allows, or storage is unavailable), so the caller can warn that this file is not crash-protected.
 */
export function saveRecoverySnapshot({
  fileName, workspaceRelPath = null, workspaceRootName = null, markdown, baselineMarkdown,
}) {
  const id = identityFor({ fileName, workspaceRelPath, workspaceRootName });
  const payload = JSON.stringify({
    id, fileName, workspaceRelPath, workspaceRootName, markdown, baselineMarkdown, savedAt: Date.now(),
  });
  const tryWrite = () => {
    try { localStorage.setItem(PREFIX + id, payload); return true; } catch { return false; }
  };
  let stored = tryWrite();
  if (!stored) {
    const oldestFirst = readAll().filter((e) => e.id !== id).sort((a, b) => a.savedAt - b.savedAt);
    while (!stored && oldestFirst.length) {
      removeEntry(oldestFirst.shift().id);
      stored = tryWrite();
    }
  }
  if (stored) enforceBudget(id);
  return stored;
}

/** Every pending snapshot, most recently saved first. */
export function listRecoverySnapshots() {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function clearRecoverySnapshot({ fileName, workspaceRelPath = null, workspaceRootName = null }) {
  removeEntry(identityFor({ fileName, workspaceRelPath, workspaceRootName }));
}
