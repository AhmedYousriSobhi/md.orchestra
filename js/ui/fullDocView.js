import { h } from '../utils/dom.js';
import { serializeMarkdown } from '../markdown/serializer.js';
import { parseMarkdown } from '../markdown/parser.js';
import { replaceWholeDocument } from '../state/store.js';
import { debounce } from '../utils/debounce.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { wireImageAttach, createAttachImageButton } from './imageAttach.js';

/**
 * Render the entire document as its own literal Markdown source — one
 * plain textarea holding exactly what serializeMarkdown(doc) would write
 * to disk (heading marker characters, note/AI-insert HTML comments,
 * everything), not a formatted or fragmented view of it. This is the
 * "pure .md file" alternative to cardGrid.js's per-section cards (see
 * docViewMode.js for when it's chosen); the preview panel is still where
 * a *rendered* read lives.
 *
 * A new heading typed directly into the text becomes a real new section
 * the moment it's saved — there's no separate "Add section" step needed
 * in this view, since editing the source *is* the document's structure.
 * Saving here means reparsing the whole text and replacing the in-memory
 * tree wholesale (state/store.js's replaceWholeDocument), unlike every
 * other editable field in the app (a section's body, a note, a title),
 * which patches one specific node in place — there's no way to know which
 * old node a given line in the freshly-typed text "used to be".
 */
export function renderFullDocView(container, doc, fileName) {
  container.innerHTML = '';
  const card = h('article', { class: 'card card-full-doc' });
  card.appendChild(h('div', { class: 'card-head' }, [
    h('h2', { class: 'card-title' }, fileName || 'Document'),
  ]));

  const textarea = h('textarea', {
    class: 'content-edit-textarea full-doc-source-textarea',
    spellcheck: 'false',
  });
  textarea.value = serializeMarkdown(doc);
  attachMarkdownEditingHelpers(textarea);
  wireImageAttach(textarea);

  const status = h('span', { class: 'editable-md-status' }, '');

  const save = (value) => {
    const parsed = parseMarkdown(value);
    replaceWholeDocument(parsed);
  };
  const debouncedSave = debounce((value) => {
    save(value);
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1200);
  }, 700);

  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    debouncedSave(textarea.value);
  });
  // Same reasoning as editableMarkdownBody.js's own blur handler: deferred
  // so a blur *caused* by clicking elsewhere (a different file, an
  // Explorer row) finishes being handled against the DOM as it existed
  // when the click landed, before a resulting re-render can replace it.
  textarea.addEventListener('blur', () => {
    debouncedSave.cancel();
    setTimeout(() => save(textarea.value), 0);
  });

  card.appendChild(h('div', { class: 'editable-md-toolbar' }, [
    createAttachImageButton(textarea),
    status,
    h('span', { class: 'editing-hint' }, 'This is the file’s raw Markdown source, in full — type a new "## Heading" directly to add a section.'),
  ]));
  card.appendChild(textarea);
  container.appendChild(card);
}
