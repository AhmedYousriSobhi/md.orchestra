import { h } from '../utils/dom.js';
import { debounce } from '../utils/debounce.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';
import { confirmDialog } from './confirmDialog.js';

const EDITING_HINT = 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats · paste or drag an image in';

/**
 * A section can hold several independent notes (not just one) — each its
 * own small card with its own textarea, debounced autosave, and delete
 * button. `handlers` is { onUpdate(id, text), onAdd(), onDelete(id) }.
 */
export function createNotesSection(notes, handlers) {
  const list = h('div', { class: 'notes-list' });
  notes.forEach((note) => list.appendChild(createNoteCard(note, handlers)));

  const addBtn = h('button', { class: 'code-btn', type: 'button', onClick: handlers.onAdd }, '+ Add note');

  return h('div', { class: 'notes-editor' }, [
    h('div', { class: 'notes-editor-head' }, [
      h('span', { class: 'notes-editor-title' }, '📝 Your notes'),
      addBtn,
    ]),
    notes.length ? list : h('p', { class: 'card-empty-note' }, 'No notes yet on this section.'),
  ]);
}

function createNoteCard(note, { onUpdate, onDelete }) {
  const textarea = h('textarea', {
    class: 'notes-textarea',
    placeholder: 'Add a note…',
    rows: '3',
  });
  textarea.value = note.text || '';
  attachMarkdownEditingHelpers(textarea);
  wireImageAttach(textarea);

  const status = h('span', { class: 'notes-status' }, '');
  const debouncedSave = debounce((value) => {
    onUpdate(note.id, value);
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1200);
  }, 900);

  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    debouncedSave(textarea.value);
  });
  // Deferred to a fresh macrotask rather than calling onUpdate() straight
  // away: blurring this textarea is very often *caused* by the user
  // clicking something else entirely (a different heading, a workspace
  // file) — and onUpdate ultimately re-renders the sidebar/file tree,
  // which would replace the very element mid-click and swallow that click
  // (its mouseup/click would land on nothing). Deferring lets the click
  // that triggered this blur finish being handled on the DOM as it existed
  // when the user pressed down, before anything gets rebuilt.
  textarea.addEventListener('blur', () => {
    debouncedSave.cancel();
    setTimeout(() => onUpdate(note.id, textarea.value), 0);
  });

  const deleteBtn = h('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': 'Delete this note',
    title: 'Delete this note',
    onClick: async () => {
      const ok = await confirmDialog({ title: 'Delete this note?', confirmLabel: 'Delete', danger: true });
      if (ok) onDelete(note.id);
    },
  }, '🗑');

  return h('div', { class: 'note-card' }, [
    h('div', { class: 'note-card-head' }, [status, createAttachImageButton(textarea), deleteBtn]),
    textarea,
    h('span', { class: 'editing-hint' }, EDITING_HINT),
  ]);
}
