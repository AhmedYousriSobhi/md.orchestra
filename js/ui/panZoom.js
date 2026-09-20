// Shared pan/wheel-zoom/pinch-zoom behavior for an SVG "world" group inside
// a container — extracted from mindMap.js (which had it first) so Tree
// mode and Workspace mode's graphs get the same touch-friendly navigation
// mind-map already had, instead of relying on native scrolling with no way
// to zoom out at all on a big tree.
const DEFAULT_MIN_ZOOM = 0.15;
const DEFAULT_MAX_ZOOM = 4;
const FIT_PADDING = 32;
const FIT_MAX_INITIAL_ZOOM = 1.5;

export function toSvgPoint(svgRoot, spaceEl, clientX, clientY) {
  if (!svgRoot.createSVGPoint) return null;
  const pt = svgRoot.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = spaceEl.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm.inverse());
}

/**
 * Wires pan (drag), wheel-zoom, and two-finger pinch-zoom onto `root` (an
 * <svg>), transforming `world` (a <g> holding everything that should
 * pan/zoom together). `getContentBounds()` returns the current
 * {minX,minY,maxX,maxY} of world-space content, used by fitToContent() —
 * called once up front and again on every Fit press. `shouldStartPan(e)`
 * gates which pointerdowns start a pan/pinch at all, so clicking/dragging
 * an actual node isn't hijacked into panning the canvas underneath it.
 * `onPointerMove(worldPoint | null)`, if given, fires on every pointermove
 * regardless of whether a pan/pinch is active (mind-map uses this for its
 * cursor-following fisheye effect; Tree/Workspace mode simply omit it).
 *
 * The container's real size is re-measured fresh on every fitToContent()
 * call rather than trusted from mount time, and a ResizeObserver re-fits
 * automatically (until the user interacts) — both carried over from a real
 * bug: at least one Android WebView read a stale/zero container size on
 * first render, silently locking the view to a wrong, frozen size forever.
 *
 * Returns `{ fitToContent, stop }`.
 */
export function attachPanZoom(root, world, container, {
  getContentBounds,
  shouldStartPan = () => true,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  fitPadding = FIT_PADDING,
  fitMaxInitialZoom = FIT_MAX_INITIAL_ZOOM,
  onPointerMove = null,
} = {}) {
  let viewW = container.clientWidth || 900;
  let viewH = Math.max(container.clientHeight || 600, 200);
  let zoom = 1;
  let tx = 0;
  let ty = 0;

  function applyTransform() {
    world.setAttribute('transform', `translate(${tx},${ty}) scale(${zoom})`);
  }

  function measureViewport() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0 && (w !== viewW || h !== viewH)) {
      viewW = w;
      viewH = Math.max(h, 200);
      root.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    }
  }

  function fitToContent() {
    measureViewport();
    const b = getContentBounds();
    const bw = Math.max(b.maxX - b.minX, 1);
    const bh = Math.max(b.maxY - b.minY, 1);
    zoom = Math.min(
      (viewW - fitPadding * 2) / bw,
      (viewH - fitPadding * 2) / bh,
      fitMaxInitialZoom,
    );
    zoom = Math.max(zoom, minZoom);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    tx = viewW / 2 - zoom * cx;
    ty = viewH / 2 - zoom * cy;
    applyTransform();
  }

  root.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);

  let userInteracted = false;
  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { if (!userInteracted) fitToContent(); })
    : null;
  resizeObserver?.observe(container);

  let panState = null;
  let pinchState = null;
  const activePointers = new Map(); // pointerId -> {x, y} in client space

  function pointerDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointerMid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function startPan(clientX, clientY, pointerId) {
    const p = toSvgPoint(root, root, clientX, clientY);
    if (!p) return;
    panState = {
      startX: p.x, startY: p.y, tx0: tx, ty0: ty, pointerId,
    };
    root.classList.add('panzoom-panning');
  }
  function startPinch() {
    const [a, b] = [...activePointers.values()];
    const mid = pointerMid(a, b);
    const rootMid = toSvgPoint(root, root, mid.x, mid.y);
    pinchState = {
      startDist: pointerDist(a, b),
      startZoom: zoom,
      worldAnchor: rootMid ? { x: (rootMid.x - tx) / zoom, y: (rootMid.y - ty) / zoom } : null,
    };
  }

  function handlePointerDown(e) {
    if (!shouldStartPan(e)) return;
    userInteracted = true;
    // A second finger touching down mid-gesture can occasionally race the
    // UA's own pointer-capture bookkeeping; failing to capture only means
    // move events might stop firing if that finger drifts off this
    // element, not that the gesture itself is invalid.
    try { root.setPointerCapture(e.pointerId); } catch { /* see above */ }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      panState = null;
      root.classList.remove('panzoom-panning');
      startPinch();
    } else if (activePointers.size === 1) {
      startPan(e.clientX, e.clientY, e.pointerId);
    }
  }

  function handlePointerMove(e) {
    if (onPointerMove) onPointerMove(toSvgPoint(root, world, e.clientX, e.clientY));
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && pinchState) {
      const [a, b] = [...activePointers.values()];
      const currentDist = pointerDist(a, b);
      if (currentDist > 0 && pinchState.startDist > 0) {
        zoom = Math.min(maxZoom, Math.max(minZoom, pinchState.startZoom * (currentDist / pinchState.startDist)));
      }
      const mid = pointerMid(a, b);
      const rootMid = toSvgPoint(root, root, mid.x, mid.y);
      if (rootMid && pinchState.worldAnchor) {
        tx = rootMid.x - zoom * pinchState.worldAnchor.x;
        ty = rootMid.y - zoom * pinchState.worldAnchor.y;
      }
      applyTransform();
      return;
    }
    if (panState && panState.pointerId === e.pointerId) {
      const p = toSvgPoint(root, root, e.clientX, e.clientY);
      if (p) {
        tx = panState.tx0 + (p.x - panState.startX);
        ty = panState.ty0 + (p.y - panState.startY);
        applyTransform();
      }
    }
  }

  function endPointer(e) {
    if (!e) return;
    activePointers.delete(e.pointerId);
    if (panState && panState.pointerId === e.pointerId) {
      panState = null;
      root.classList.remove('panzoom-panning');
    }
    if (pinchState) {
      pinchState = null;
      // One finger still down after a pinch ends — resume panning from
      // its current position instead of dropping straight to nothing.
      const remaining = [...activePointers.entries()][0];
      if (remaining) startPan(remaining[1].x, remaining[1].y, remaining[0]);
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    userInteracted = true;
    const rootPt = toSvgPoint(root, root, e.clientX, e.clientY);
    if (!rootPt) return;
    const worldBefore = { x: (rootPt.x - tx) / zoom, y: (rootPt.y - ty) / zoom };
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
    tx = rootPt.x - zoom * worldBefore.x;
    ty = rootPt.y - zoom * worldBefore.y;
    applyTransform();
  }

  root.addEventListener('pointerdown', handlePointerDown);
  root.addEventListener('pointermove', handlePointerMove);
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);
  root.addEventListener('pointerleave', endPointer);
  root.addEventListener('wheel', handleWheel, { passive: false });

  fitToContent();

  return {
    fitToContent,
    stop() {
      resizeObserver?.disconnect();
      root.removeEventListener('pointerdown', handlePointerDown);
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerup', endPointer);
      root.removeEventListener('pointercancel', endPointer);
      root.removeEventListener('pointerleave', endPointer);
      root.removeEventListener('wheel', handleWheel);
    },
  };
}
