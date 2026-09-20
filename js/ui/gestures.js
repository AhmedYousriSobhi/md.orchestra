const SWIPE_THRESHOLD = 60;
// Horizontal movement has to dominate vertical by this much before it counts
// as a swipe at all -- without this, an ordinary vertical scroll that drifts
// a little sideways would misfire a swipe action halfway through.
const DIRECTION_RATIO = 1.5;

/**
 * Recognizes a single-finger horizontal swipe on `el`. Touch-first
 * deliberately: real mice already have every affordance these gestures
 * exist for as an actual click, so a mouse-driven drag (text selection,
 * dragging a mind-map node, resizing a panel) is never reinterpreted as a
 * swipe here.
 *
 * `onSwipeLeft`/`onSwipeRight` fire once, the instant the gesture crosses
 * the threshold rather than waiting for release -- the response feels
 * immediate, and whatever CSS transition is already driving the resulting
 * state change (the sidebar drawer's own transform, for instance) animates
 * the rest on its own. `shouldStart(e)` gates which pointerdowns begin
 * tracking at all, so a swipe never hijacks an interactive element's own
 * tap or drag.
 */
export function bindHorizontalSwipe(el, {
  shouldStart, onSwipeLeft, onSwipeRight, threshold = SWIPE_THRESHOLD,
}) {
  let tracking = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (shouldStart && !shouldStart(e)) return;
    tracking = {
      startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, fired: false,
    };
  });

  el.addEventListener('pointermove', (e) => {
    if (!tracking || tracking.pointerId !== e.pointerId || tracking.fired) return;
    const dx = e.clientX - tracking.startX;
    const dy = e.clientY - tracking.startY;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
    tracking.fired = true;
    if (dx > 0) onSwipeRight?.(); else onSwipeLeft?.();
  });

  function endTracking(e) {
    if (tracking && tracking.pointerId === e.pointerId) tracking = null;
  }
  el.addEventListener('pointerup', endTracking);
  el.addEventListener('pointercancel', endTracking);
}
