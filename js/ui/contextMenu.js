import { h } from '../utils/dom.js';

let menuEl = null;
let outsideHandler = null;
let keyHandler = null;

function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  if (outsideHandler) document.removeEventListener('mousedown', outsideHandler);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  outsideHandler = null;
  keyHandler = null;
}

/**
 * A single shared right-click context menu — only one can ever be open at
 * once, the same assumption the overflow/samples dropdowns elsewhere in
 * the app already make. `items` is a list of either `{ label, onClick,
 * danger?, disabled?, title? }` or the string `'separator'` for a thin
 * divider between groups of related actions. Positioned at the triggering
 * event's own coordinates, clamped so it never renders off the right/
 * bottom edge of the viewport.
 */
export function showContextMenu(event, items) {
  event.preventDefault();
  closeMenu();

  menuEl = h('div', { class: 'context-menu', role: 'menu' }, items.map((item) => (
    item === 'separator'
      ? h('div', { class: 'context-menu-sep' })
      : h('button', {
        class: `context-menu-item${item.danger ? ' context-menu-item-danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        disabled: Boolean(item.disabled),
        title: item.title || '',
        onClick: () => { closeMenu(); item.onClick(); },
      }, item.label)
  )));

  document.body.appendChild(menuEl);

  const { innerWidth, innerHeight } = window;
  const { width, height } = menuEl.getBoundingClientRect();
  const left = Math.min(event.clientX, innerWidth - width - 8);
  const top = Math.min(event.clientY, innerHeight - height - 8);
  menuEl.style.left = `${Math.max(8, left)}px`;
  menuEl.style.top = `${Math.max(8, top)}px`;

  // Deferred so the very mousedown/contextmenu event that opened this menu
  // doesn't immediately count as the "outside click" that closes it again.
  setTimeout(() => {
    outsideHandler = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
    document.addEventListener('mousedown', outsideHandler);
  }, 0);
  keyHandler = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('keydown', keyHandler);
}
