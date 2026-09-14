// Small shared helpers for the before/inside/after drag-and-drop zones
// used by both the sidebar (reordering/relocating existing sections) and
// the tree picker in "+ New section" (placing brand-new content).

/** Which third of `el`'s box the pointer is over: 'before' | 'inside' | 'after'. */
export function dropZoneFor(el, clientY) {
  const rect = el.getBoundingClientRect();
  const rel = (clientY - rect.top) / rect.height;
  if (rel < 0.3) return 'before';
  if (rel > 0.7) return 'after';
  return 'inside';
}

const HIGHLIGHT_CLASSES = ['tree-drop-before', 'tree-drop-inside', 'tree-drop-after'];

export function clearDropHighlight(root) {
  root.querySelectorAll(HIGHLIGHT_CLASSES.map((c) => `.${c}`).join(',')).forEach((el) => {
    el.classList.remove(...HIGHLIGHT_CLASSES);
  });
}

export function setDropHighlight(el, zone) {
  el.classList.remove(...HIGHLIGHT_CLASSES);
  el.classList.add(`tree-drop-${zone}`);
}
