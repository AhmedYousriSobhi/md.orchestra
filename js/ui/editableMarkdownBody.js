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
/** Grows (or shrinks) `textarea` to exactly fit its own content — no scrollbar, no manual drag-to-resize needed just to see the rest of what's already there. */
function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * scrollHeight only reflects the *current* width — sizing a textarea once
 * (on creation, or as its own content changes) goes stale the moment
 * something else changes how much horizontal room it has: the ☰ sidebar
 * toggle, dragging the preview-panel divider, resizing the window. None of
 * those fire an 'input' event on the textarea itself, so nothing would
 * otherwise notice the same text now wraps onto a different number of
 * lines. Called by main.js whenever the panel these textareas live in
 * changes width, for whichever of them currently happen to be mounted.
 */
export function resizeEditableMarkdownTextareas() {
  document.querySelectorAll('.editable-md-textarea').forEach(autosize);
}

export function createEditableMarkdownBody(node, { placeholder = 'Nothing here yet — start typing…' } = {}) {
  const { main } = splitBody(node.bodyMarkdown);
  const textarea = h('textarea', { class: 'content-edit-textarea editable-md-textarea', placeholder });
  textarea.value = main;
  attachMarkdownEditingHelpers(textarea);
  wireImageAttach(textarea);

  // Sized to fit the whole section by default, not just whatever a fixed
  // min-height happens to show — scrollHeight only reads correctly once
  // this is actually laid out in the DOM, which the caller (cardGrid.js/
  // fullDocView.js) does synchronously right after this returns, so the
  // next animation frame is the first point it's reliably available.
  requestAnimationFrame(() => autosize(textarea));
  textarea.addEventListener('input', () => autosize(textarea));

  const status = h('span', { class: 'editable-md-status' }, '');

  // Set once an *external* mutation of this same node (cardGrid.js's
  // Regenerate-from-headings / Undo buttons) needs to win over whatever's
  // still pending here — cancelling the debounce alone isn't enough,
  // since the blur handler below (which typically fires first, as
  // clicking any button blurs this field before that button's own click
  // handler runs) schedules its *own* independent flush via a bare
  // setTimeout, which debouncedSave.cancel() has no power over. A fresh
  // keystroke re-arms it, in the unlikely case this element somehow
  // survives to be typed into again rather than getting rebuilt fresh.
  let cancelled = false;
  const save = (value) => {
    if (cancelled) return;
    const parts = splitBody(node.bodyMarkdown);
    updateNode(node.id, { bodyMarkdown: joinBody({ ...parts, main: value }) });
  };
  const debouncedSave = debounce((value) => {
    save(value);
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1200);
  }, 900);

  textarea.addEventListener('input', () => {
    cancelled = false;
    status.textContent = 'Saving…';
    debouncedSave(textarea.value);
  });
  // Deferred to a fresh macrotask, same reasoning as notesPanel.js's own
  // blur handler: blurring this textarea is very often *caused* by
  // clicking something else entirely (a different heading, a workspace
  // file), and save() ultimately re-renders that same area — doing it
  // immediately would replace the very element mid-click. Redundant with
  // the debounce if it already fired (store.js's updateNode() no-ops a
  // patch that doesn't actually change anything rather than pushing a
  // phantom undo entry) — but still needed to *trigger* a render at all
  // once focus moves on, since one was very possibly suppressed while
  // this field had focus (see main.js's own "don't rebuild mid-edit"
  // guard).
  textarea.addEventListener('blur', () => {
    debouncedSave.cancel();
    setTimeout(() => save(textarea.value), 0);
  });

  const wrap = h('div', { class: 'editable-md-body' }, [
    textarea,
    h('div', { class: 'editable-md-toolbar' }, [
      createAttachImageButton(textarea),
      status,
      h('span', { class: 'editing-hint' }, EDITING_HINT),
    ]),
  ]);
  wrap.cancelPendingSave = () => {
    debouncedSave.cancel();
    cancelled = true;
  };
  return wrap;
}
