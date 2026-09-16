import { h } from '../utils/dom.js';
import { splitBody, joinBody } from '../markdown/markers.js';
import { updateNode } from '../state/store.js';
import { debounce } from '../utils/debounce.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';

const EDITING_HINT = 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats · paste or drag an image in';

/**
 * A section's own "main" content (marker-stripped — see markers.js
 * splitBody), as a plain, always-editable Markdown textarea rather than a
 * rendered view with a separate "enter edit mode" step: typed changes save
 * themselves, debounced, straight back into the document via updateNode()
 * — the same autosave model notes already use (see notesPanel.js).
 * Rendering a section's *formatted* content is the preview panel's job
 * (previewPanel.js, unchanged); this is the raw source, not a read view of
 * it, used by both cardGrid.js's focused card and fullDocView.js.
 */
export function createEditableMarkdownBody(node, { placeholder = 'Nothing here yet — start typing…' } = {}) {
  const { main } = splitBody(node.bodyMarkdown);
  const textarea = h('textarea', { class: 'content-edit-textarea editable-md-textarea', placeholder });
  textarea.value = main;
  attachMarkdownEditingHelpers(textarea);
  wireImageAttach(textarea);

  const status = h('span', { class: 'editable-md-status' }, '');

  const save = (value) => {
    const parts = splitBody(node.bodyMarkdown);
    updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, main: value }) });
  };
  const debouncedSave = debounce((value) => {
    save(value);
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1200);
  }, 900);

  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    debouncedSave(textarea.value);
  });
  // Deferred to a fresh macrotask, same reasoning as notesPanel.js's own
  // blur handler: blurring this textarea is very often *caused* by
  // clicking something else entirely (a different heading, a workspace
  // file), and save() ultimately re-renders that same area — doing it
  // immediately would replace the very element mid-click.
  textarea.addEventListener('blur', () => {
    debouncedSave.cancel();
    setTimeout(() => save(textarea.value), 0);
  });

  return h('div', { class: 'editable-md-body' }, [
    textarea,
    h('div', { class: 'editable-md-toolbar' }, [
      createAttachImageButton(textarea),
      status,
      h('span', { class: 'editing-hint' }, EDITING_HINT),
    ]),
  ]);
}
