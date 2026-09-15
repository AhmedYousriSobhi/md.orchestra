import { h, escapeHtml } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { downloadText, guessCodeFileExtension } from '../core/fileIO.js';
import { showToast } from './toast.js';

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = h('div', { class: 'overlay code-viewer-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeOverlay(overlayEl);
  });
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/** Open the dedicated full-screen code viewer for one snippet: {lang, code, title}. */
export function openCodeViewer({ lang, code, title }) {
  const overlay = ensureOverlay();
  overlay.innerHTML = '';

  const highlighted = window.hljs
    ? (window.hljs.getLanguage(lang) ? window.hljs.highlight(code, { language: lang }).value : window.hljs.highlightAuto(code).value)
    : escapeHtml(code);

  const panel = h('div', { class: 'code-viewer-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'code-viewer-head' }, [
      h('div', {}, [
        h('div', { class: 'code-viewer-title' }, title || 'Code snippet'),
        h('div', { class: 'code-viewer-lang' }, lang || 'text'),
      ]),
      h('div', { class: 'code-viewer-actions' }, [
        h('button', {
          class: 'code-btn',
          type: 'button',
          onClick: async (e) => {
            await navigator.clipboard.writeText(code);
            e.target.textContent = 'Copied ✓';
            setTimeout(() => { e.target.textContent = 'Copy'; }, 1400);
          },
        }, 'Copy'),
        h('button', {
          class: 'code-btn',
          type: 'button',
          onClick: () => {
            downloadText(`snippet.${guessCodeFileExtension(lang)}`, code);
            showToast('Snippet downloaded');
          },
        }, 'Download'),
        h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlay) }, 'Close ✕'),
      ]),
    ]),
    h('pre', { class: 'code-viewer-body hljs', html: `<code class="hljs language-${lang || 'plaintext'}">${highlighted}</code>` }),
  ]);

  overlay.appendChild(panel);
  openOverlay(overlay);
}
