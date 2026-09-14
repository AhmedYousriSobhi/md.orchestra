import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { nextId } from '../utils/id.js';
import { findNode } from '../markdown/parser.js';
import {
  getState, insertSection, selectSection, getSelectedNode,
} from '../state/store.js';
import { renderRadialPicker } from './radialPicker.js';
import { showToast } from './toast.js';

let overlayEl = null;

/**
 * Open a form for authoring a brand-new section anywhere in the document:
 * title, heading level, which existing section to nest it under — picked
 * from a sunburst diagram of the whole document rather than a plain
 * dropdown, so "where" is a spatial choice, not a list to read — whether it
 * goes first or last among that parent's children, and its initial
 * Markdown body. Unlike the notes field, this becomes real document
 * content, not an annotation.
 */
export function openAddSectionModal() {
  const { doc } = getState();
  if (!doc) { showToast('Load a document first', { type: 'error' }); return; }

  const current = getSelectedNode();
  let parentId = current ? current.id : doc.id;

  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const titleInput = h('input', {
    type: 'text', class: 'settings-input', placeholder: 'e.g. "Rollback procedure"',
  });

  const pickedLabel = h('div', { class: 'radial-picked-label' });
  const pickerBox = h('div', { class: 'radial-svg-box' });

  const levelSelect = h('select', { class: 'settings-input' });
  function refreshLevelOptions() {
    const parentNode = parentId === doc.id ? null : findNode(doc, parentId);
    const parentLevel = parentNode ? parentNode.level : 0;
    const defaultLevel = Math.min(Math.max(parentLevel + 1, 1), 6);
    levelSelect.innerHTML = '';
    for (let lvl = 1; lvl <= 6; lvl += 1) {
      const opt = h('option', { value: String(lvl) }, `Heading ${lvl} (${'#'.repeat(lvl)})`);
      if (lvl === defaultLevel) opt.selected = true;
      levelSelect.appendChild(opt);
    }
  }

  function updatePickedLabel() {
    const parentNode = parentId === doc.id ? null : findNode(doc, parentId);
    pickedLabel.innerHTML = '';
    pickedLabel.appendChild(document.createTextNode('Adding under: '));
    const strong = h('strong', {}, parentNode ? parentNode.title : '(top of document)');
    pickedLabel.appendChild(strong);
  }

  function onPick(id) {
    parentId = id;
    renderRadialPicker(pickerBox, doc, parentId, onPick);
    updatePickedLabel();
    refreshLevelOptions();
  }
  renderRadialPicker(pickerBox, doc, parentId, onPick);
  updatePickedLabel();
  refreshLevelOptions();

  const positionSelect = h('select', { class: 'settings-input' }, [
    h('option', { value: 'end' }, 'Last, after its existing subsections'),
    h('option', { value: 'start' }, 'First, before its existing subsections'),
  ]);

  const contentTextarea = h('textarea', {
    class: 'notes-textarea',
    rows: '6',
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
    const ok = insertSection({ parentId, node, position: positionSelect.value });
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
        h('h3', {}, 'Nest under — click a wedge, or the center for the top of the document'),
        h('div', { class: 'radial-picker-wrap' }, [pickerBox, pickedLabel]),
      ]),
      h('div', { class: 'add-section-grid' }, [
        h('div', { class: 'insight-section' }, [h('h3', {}, 'Heading level'), levelSelect]),
        h('div', { class: 'insight-section' }, [h('h3', {}, 'Position'), positionSelect]),
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
