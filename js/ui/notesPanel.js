import { h } from '../utils/dom.js';
import { debounce } from '../utils/debounce.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';

/**
 * A self-contained "your notes" editor for one section. Calls
 * onSave(text) (debounced) as the user types, and immediately on blur.
 */
export function createNotesEditor(initialText, onSave) {
  const textarea = h('textarea', {
    class: 'notes-textarea',
    placeholder: 'Add your own notes for this section…',
    rows: '3',
  });
  textarea.value = initialText || '';
  attachMarkdownEditingHelpers(textarea);

  const status = h('span', { class: 'notes-status' }, '');
  const debouncedSave = debounce((value) => {
    onSave(value);
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1200);
  }, 900);

  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    debouncedSave(textarea.value);
  });
  textarea.addEventListener('blur', () => onSave(textarea.value));

  return h('div', { class: 'notes-editor' }, [
    h('div', { class: 'notes-editor-head' }, [
      h('span', { class: 'notes-editor-title' }, '📝 Your notes'),
      status,
    ]),
    textarea,
    h('span', { class: 'editing-hint' }, 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats'),
  ]);
}
