// Two-finger pinch-to-zoom for a plain HTML reading surface (the preview
// panel, the main document view) — a different problem from panZoom.js's
// SVG canvas pan/zoom, since there's no "world" transform group here, just
// flowing text and images. Uses the CSS `zoom` property (well-supported in
// every Chromium build, which both this app's Electron and Capacitor
// shells are built on) rather than `transform: scale()`: `zoom` actually
// reflows layout, so bigger text just takes more vertical space the same
// way a browser's own page zoom does, instead of visually scaling content
// that then overflows its own container with no natural way to reach the
// overflow.
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const STORAGE_PREFIX = 'md-orchestra:content-zoom:';

function getStoredZoom(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const n = raw ? parseFloat(raw) : 1;
    return Number.isFinite(n) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n)) : 1;
  } catch {
    return 1;
  }
}
function setStoredZoom(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, String(value)); } catch { /* private mode, storage full, etc. */ }
}

/**
 * Wires pinch-to-zoom onto `container`, remembering the chosen level under
 * `storageKey` (each reading surface keeps its own — the preview panel and
 * the main document view are sized differently and don't need to force
 * the same zoom level onto each other). `touch-action: pan-y` keeps normal
 * single-finger vertical scrolling native; only a second simultaneous
 * finger is ever treated as a pinch, so it can't misfire during an
 * ordinary one-finger scroll through a long document.
 *
 * Returns a `stop()` to remove the listeners.
 */
export function attachTextPinchZoom(container, { storageKey }) {
  let zoom = getStoredZoom(storageKey);
  container.style.touchAction = 'pan-y';
  container.style.zoom = String(zoom);

  const activePointers = new Map(); // pointerId -> {x, y}
  let startDist = null;
  let startZoom = zoom;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function handlePointerDown(e) {
    if (e.pointerType === 'mouse') return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      startDist = dist(a, b);
      startZoom = zoom;
    }
  }
  function handlePointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2 && startDist) {
      const [a, b] = [...activePointers.values()];
      const currentDist = dist(a, b);
      if (currentDist > 0) {
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * (currentDist / startDist)));
        container.style.zoom = String(zoom);
      }
    }
  }
  function endPointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      startDist = null;
      setStoredZoom(storageKey, zoom);
    }
  }

  container.addEventListener('pointerdown', handlePointerDown);
  container.addEventListener('pointermove', handlePointerMove);
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);

  return function stop() {
    container.removeEventListener('pointerdown', handlePointerDown);
    container.removeEventListener('pointermove', handlePointerMove);
    container.removeEventListener('pointerup', endPointer);
    container.removeEventListener('pointercancel', endPointer);
  };
}
