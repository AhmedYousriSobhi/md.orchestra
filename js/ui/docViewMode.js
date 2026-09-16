import { computeDocStats } from '../markdown/docStats.js';

// A document under this many characters of its own actual content reads
// comfortably in one continuous page; splitting it into per-section cards
// mostly just produces a handful of near-empty "dummy" cards instead of
// making anything easier to navigate. Longer documents still default the
// other way, where drilling down section-by-section genuinely helps.
const FULL_VIEW_CHAR_THRESHOLD = 6000;

/**
 * The view mode ('full' | 'sections') this document's own length and
 * structure recommend by default, before any per-document override — see
 * get/setStoredMode below.
 */
export function recommendedMode(doc) {
  const { totalChars, headingCount } = computeDocStats(doc);
  if (headingCount <= 1) return 'full';
  return totalChars <= FULL_VIEW_CHAR_THRESHOLD ? 'full' : 'sections';
}

const STORAGE_KEY = 'mdDashboard.docViewMode';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/**
 * A stable per-document identity: workspace files by root name + relative
 * path, standalone ones by file name — the same boundary the rest of the
 * app (e.g. recovery snapshots) already uses to tell one open document
 * from another.
 */
export function docModeKey({ workspaceRootName, workspaceRelPath, fileName }) {
  return workspaceRootName ? `ws:${workspaceRootName}:${workspaceRelPath}` : `standalone:${fileName}`;
}

/** The user's own remembered choice for this document, or null if they haven't overridden the recommendation yet. */
export function getStoredMode(key) {
  const mode = readAll()[key];
  return mode === 'full' || mode === 'sections' ? mode : null;
}

export function setStoredMode(key, mode) {
  const all = readAll();
  all[key] = mode;
  writeAll(all);
}
