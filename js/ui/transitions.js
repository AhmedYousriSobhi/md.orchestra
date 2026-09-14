/**
 * Swap a container's content with a fade+slide transition instead of an
 * instant re-render. `renderFn(container)` should populate `container`
 * synchronously; `direction` is 'forward' (drilling into a section) or
 * 'back' (returning to a parent/sibling), which mirrors the slide.
 */
export function animatedSwap(container, renderFn, direction = 'forward') {
  const outClass = direction === 'back' ? 'panel-out-back' : 'panel-out-forward';
  const inClass = direction === 'back' ? 'panel-in-back' : 'panel-in-forward';

  container.classList.add(outClass);
  const finish = () => {
    container.classList.remove(outClass);
    container.innerHTML = '';
    renderFn(container);
    container.classList.add(inClass);
    requestAnimationFrame(() => {
      // trigger the enter transition on the next frame
      container.classList.add('panel-in-active');
    });
    setTimeout(() => container.classList.remove(inClass, 'panel-in-active'), 380);
  };

  // If the container is empty (first render), skip the exit animation.
  if (!container.firstChild) {
    container.classList.remove(outClass);
    finish();
    return;
  }
  setTimeout(finish, 140);
}

export function openOverlay(el) {
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('overlay-open'));
}

export function closeOverlay(el, after) {
  el.classList.remove('overlay-open');
  setTimeout(() => {
    el.hidden = true;
    if (after) after();
  }, 220);
}

// Any overlay opened via openOverlay() can be dismissed with Escape, so
// individual panels/modals don't each need to wire their own key handler.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.overlay.overlay-open').forEach((ov) => closeOverlay(ov));
});
