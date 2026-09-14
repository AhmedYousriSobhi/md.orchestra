export function debounce(fn, delayMs = 300) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
