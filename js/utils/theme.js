const STORAGE_KEY = 'md-dashboard-theme';

/** 'light' | 'dark' | 'system' (the default: follows the OS preference). */
export function getTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode, etc.) — fall through to system */
  }
  return 'system';
}

/** Stamps data-theme on <html> so CSS (base.css) can key off it; 'system' removes the attribute, leaving the OS-preference media query in charge. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

export function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore — theme still applies for this page view, just won't persist */
  }
  applyTheme(theme);
}
