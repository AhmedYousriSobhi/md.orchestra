// A crash-recovery snapshot: the current document's serialized Markdown,
// stashed in localStorage while there are unsaved changes, so a crashed tab
// or an accidentally-closed window doesn't lose work — the next load offers
// to restore it. This is a local safety net, not a save: it's cleared the
// moment the real save happens (or the user declines the restore prompt).
const KEY = 'mdDashboard.recovery.v1';

export function saveRecoverySnapshot({ fileName, markdown }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ fileName, markdown, savedAt: Date.now() }));
  } catch {
    // localStorage full/unavailable (private browsing, quota) — recovery is best-effort only.
  }
}

export function loadRecoverySnapshot() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearRecoverySnapshot() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
