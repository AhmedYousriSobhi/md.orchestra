import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { nextId } from '../utils/id.js';
import { findNode } from '../markdown/parser.js';
import { generateTocMarkdown, looksLikeTocSection } from '../markdown/toc.js';
import {
  getState, insertSection, selectSection, getSelectedNode,
} from '../state/store.js';
import { renderTreePicker } from './treePicker.js';
import { attachMarkdownEditingHelpers } from './markdownEditing.js';
import { showToast } from './toast.js';

let overlayEl = null;

function describeTarget(doc, target) {
  const refNode = target.referenceId === doc.id ? null : findNode(doc, target.referenceId);
  const label = refNode ? refNode.title : 'the document';
  if (target.placement === 'before') return `Right before "${label}"`;
  if (target.placement === 'after') return `Right after "${label}"`;
  if (target.referenceId === doc.id) return 'At the top of the document';
  return `Inside "${label}", as its last subsection`;
}

function defaultLevelFor(doc, target) {
  if (target.placement === 'before' || target.placement === 'after') {
    const refNode = findNode(doc, target.referenceId);
    return refNode ? refNode.level : 1;
  }
  if (target.referenceId === doc.id) return 1;
  const refNode = findNode(doc, target.referenceId);
  return refNode ? Math.min(refNode.level + 1, 6) : 1;
}

/**
 * Open a form for authoring a brand-new section anywhere in the document:
 * title, heading level, and exactly where it goes — click a heading in the
 * tree to drop it inside (as the last subsection), or drag the handle onto
 * the tree and hover the top/bottom third of a row to place it precisely
 * before/after that heading instead of only "first/last of its parent" —
 * plus its initial Markdown body. Unlike the notes field, this becomes
 * real document content, not an annotation.
 */
export function openAddSectionModal() {
  const { doc } = getState();
  if (!doc) { showToast('Load a document first', { type: 'error' }); return; }

  const current = getSelectedNode();
  let target = { referenceId: current ? current.id : doc.id, placement: 'inside-end' };

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const titleInput = h('input', {
    type: 'text', class: 'settings-input', placeholder: 'e.g. "Rollback procedure"',
  });

  const pickedLabel = h('div', { class: 'tree-picker-label' });
  const pickerBox = h('div', { class: 'tree-picker-box' });

  const dragHandle = h('div', { class: 'tree-drag-handle', draggable: 'true' }, [
    '⠿ Drag onto the tree to place it precisely (before/after/inside a heading)',
  ]);
  dragHandle.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'new-section');
  });

  const levelSelect = h('select', { class: 'settings-input' });
  function refreshLevelOptions() {
    const defaultLevel = defaultLevelFor(doc, target);
    levelSelect.innerHTML = '';
    for (let lvl = 1; lvl <= 6; lvl += 1) {
      const opt = h('option', { value: String(lvl) }, `Heading ${lvl} (${'#'.repeat(lvl)})`);
      if (lvl === defaultLevel) opt.selected = true;
      levelSelect.appendChild(opt);
    }
  }

  function setTarget(next) {
    target = next;
    renderTreePicker(pickerBox, doc, target, setTarget);
    pickedLabel.textContent = describeTarget(doc, target);
    refreshLevelOptions();
  }
  renderTreePicker(pickerBox, doc, target, setTarget);
  pickedLabel.textContent = describeTarget(doc, target);
  refreshLevelOptions();

  const contentTextarea = h('textarea', {
    class: 'notes-textarea',
    rows: '6',
    placeholder: 'Section content in Markdown — optional, you can also fill this in afterward from the card.',
  });
  attachMarkdownEditingHelpers(contentTextarea);

  // Typing a title like "Table of Contents" drafts one from the document's
  // current headings right away, same as VS Code's Markdown All in One
  // picking up a ToC as soon as you start writing it — only while the
  // content is still untouched, so it never overwrites something typed.
  titleInput.addEventListener('input', () => {
    if (!contentTextarea.value.trim() && looksLikeTocSection({ title: titleInput.value })) {
      contentTextarea.value = generateTocMarkdown(doc, {});
    }
  });

  const submit = () => {
    const title = titleInput.value.trim();
    if (!title) { showToast('Give the new section a title first', { type: 'error' }); return; }
    const node = {
      id: nextId('sec'),
      level: Number(levelSelect.value),
      title,
      bodyMarkdown: contentTextarea.value.trim(),
      children: [],
    };
    const ok = insertSection({ node, referenceId: target.referenceId, placement: target.placement });
    if (!ok) { showToast('Could not add the section', { type: 'error' }); return; }
    selectSection(node.id);
    closeOverlay(overlayEl);
    showToast(`Added "${title}"`);
  };

  const panel = h('div', { class: 'insight-panel add-section-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '+ New section'),
        h('div', { class: 'insight-subtitle' }, 'Write a whole new part of the document, wherever it belongs.'),
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'insight-body' }, [
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Title'),
        titleInput,
      ]),
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Where'),
        dragHandle,
        pickerBox,
        pickedLabel,
      ]),
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Heading level'),
        levelSelect,
      ]),
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Content'),
        contentTextarea,
        h('span', { class: 'editing-hint' }, 'Enter continues a list · Tab/Shift+Tab indents · Ctrl/⌘+B/I/` formats'),
      ]),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, 'Add section'),
    ]),
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  titleInput.focus();
}
