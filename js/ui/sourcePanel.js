import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { serializeMarkdown } from '../markdown/serializer.js';
import { downloadText, writeToHandle, supportsFileSystemAccess } from '../fileIO.js';
import { showToast } from './toast.js';
import { getState, setState } from '../state/store.js';

let overlayEl = null;

function sourceHelpText(fileHandle, fileName) {
  const base = 'This is generated live from the cards, notes, and AI suggestions above.';
  if (fileHandle) return `${base} Save it back to the original file, or download a copy.`;
  if (supportsFileSystemAccess) {
    return `${base} "${fileName}" wasn't opened with the file picker (it was loaded another way — a sample, drag-and-drop, or the plain file input), so there's no direct handle to save back to. Use Download, then replace the file on disk yourself. To save in place next time, use "Open .md file".`;
  }
  return `${base} Your browser doesn't support saving straight back to a file, so use Download to get the updated Markdown, then replace the original file with it.`;
}

export function openSourcePanel() {
  const { doc, fileName, fileHandle } = getState();
  if (!doc) { showToast('Load a document first', { type: 'error' }); return; }
  const text = serializeMarkdown(doc);

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay side-panel-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const saveDirectBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    hidden: !fileHandle,
    onClick: async () => {
      try {
        await writeToHandle(fileHandle, text);
        setState({ dirty: false });
        showToast(`Saved to ${fileName}`);
      } catch (err) {
        showToast(`Save failed: ${err.message}`, { type: 'error' });
      }
    },
  }, `Save to ${fileName || 'file'}`);

  const panel = h('div', { class: 'side-panel source-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('h2', {}, 'Markdown source'),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'side-panel-body' }, [
      h('p', { class: 'settings-help' }, sourceHelpText(fileHandle, fileName)),
      h('textarea', { class: 'source-textarea', readonly: true, html: undefined }, []),
      h('div', { class: 'settings-actions' }, [
        saveDirectBtn,
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: async () => {
            await navigator.clipboard.writeText(text);
            showToast('Copied to clipboard');
          },
        }, 'Copy'),
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onClick: () => downloadText(fileName || 'document.md', text),
        }, 'Download .md'),
      ]),
    ]),
  ]);

  panel.querySelector('.source-textarea').value = text;
  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
}
