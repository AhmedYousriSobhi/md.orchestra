import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { nextId } from '../utils/id.js';
import {
  getState, insertSection, selectSection, getSelectedNode,
} from '../state/store.js';
import { showToast } from './toast.js';

let overlayEl = null;

/** Flatten the tree into {id, level, title} in document order, plus a synthetic root entry. */
function flattenForParentPicker(doc) {
  const options = [{ id: doc.id, level: 0, title: null }];
  function walk(node) {
    options.push({ id: node.id, level: node.level, title: node.title });
    node.children.forEach(walk);
  }
  doc.children.forEach(walk);
  return options;
}

function parentOptionLabel(opt) {
  if (opt.level === 0) return '(Top of document — no parent heading)';
  const indent = '  '.repeat(Math.max(opt.level - 1, 0));
  return `${indent}${'#'.repeat(opt.level)} ${opt.title || '(untitled)'}`;
}

/**
 * Open a form for authoring a brand-new section anywhere in the document:
 * title, heading level, which existing section to nest it under (defaulting
 * to whatever's currently open, but overridable to anywhere in the tree),
 * whether it goes first or last among that parent's children, and its
 * initial Markdown body — unlike the notes field, this becomes real
 * document content, not an annotation.
 */
export function openAddSectionModal() {
  const { doc } = getState();
  if (!doc) { showToast('Load a document first', { type: 'error' }); return; }

  const current = getSelectedNode();
  const options = flattenForParentPicker(doc);

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const titleInput = h('input', {
    type: 'text', class: 'settings-input', placeholder: 'e.g. "Rollback procedure"',
  });

  const parentSelect = h('select', { class: 'settings-input' }, options.map((opt) => {
    const el = h('option', { value: opt.id }, parentOptionLabel(opt));
    if (current && opt.id === current.id) el.selected = true;
    return el;
  }));

  const levelSelect = h('select', { class: 'settings-input' });
  function refreshLevelOptions() {
    const parentOpt = options.find((opt) => opt.id === parentSelect.value);
    const parentLevel = parentOpt ? parentOpt.level : 0;
    const defaultLevel = Math.min(Math.max(parentLevel + 1, 1), 6);
    levelSelect.innerHTML = '';
    for (let lvl = 1; lvl <= 6; lvl += 1) {
      const opt = h('option', { value: String(lvl) }, `Heading ${lvl} (${'#'.repeat(lvl)})`);
      if (lvl === defaultLevel) opt.selected = true;
      levelSelect.appendChild(opt);
    }
  }
  refreshLevelOptions();
  parentSelect.addEventListener('change', refreshLevelOptions);

  const positionSelect = h('select', { class: 'settings-input' }, [
    h('option', { value: 'end' }, 'Last, after its existing subsections'),
    h('option', { value: 'start' }, 'First, before its existing subsections'),
  ]);

  const contentTextarea = h('textarea', {
    class: 'notes-textarea',
    rows: '7',
    placeholder: 'Section content in Markdown — optional, you can also fill this in afterward from the card.',
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
    const ok = insertSection({ parentId: parentSelect.value, node, position: positionSelect.value });
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
      h('div', { class: 'add-section-grid' }, [
        h('div', { class: 'insight-section' }, [h('h3', {}, 'Nest under'), parentSelect]),
        h('div', { class: 'insight-section' }, [h('h3', {}, 'Heading level'), levelSelect]),
        h('div', { class: 'insight-section' }, [h('h3', {}, 'Where'), positionSelect]),
      ]),
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Content'),
        contentTextarea,
      ]),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, 'Add section'),
    ]),
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  titleInput.focus();
}
