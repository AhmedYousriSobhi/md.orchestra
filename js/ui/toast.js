let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-stack';
  document.body.appendChild(container);
  return container;
}

export function showToast(message, { type = 'info', duration = 3200 } = {}) {
  const stack = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-in'));
  setTimeout(() => {
    el.classList.remove('toast-in');
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 260);
  }, duration);
}
