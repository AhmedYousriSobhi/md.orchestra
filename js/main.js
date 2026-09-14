import { parseMarkdown } from './markdown/parser.js';
import {
  getState, subscribe, loadDocument, selectSection, getSelectedNode, getSelectedPath,
} from './state/store.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderBreadcrumb } from './ui/breadcrumb.js';
import { renderSectionView } from './ui/cardGrid.js';
import { animatedSwap } from './ui/transitions.js';
import {
  readFile, fetchSample, openFilePicker, supportsFileSystemAccess,
} from './fileIO.js';
import { showToast } from './ui/toast.js';
import { openSettingsPanel } from './ui/settingsPanel.js';
import { openSourcePanel } from './ui/sourcePanel.js';
import { openAddSectionModal } from './ui/addSectionModal.js';
import { openMapView } from './ui/mapView.js';

const el = {
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  breadcrumb: document.getElementById('breadcrumb-bar'),
  sectionView: document.getElementById('section-view'),
  emptyState: document.getElementById('empty-state'),
  fileInput: document.getElementById('file-input'),
  openFileBtn: document.getElementById('open-file-btn'),
  samplesBtn: document.getElementById('samples-btn'),
  samplesDropdown: document.getElementById('samples-dropdown'),
  emptySampleBtn: document.getElementById('empty-sample-btn'),
  addSectionBtn: document.getElementById('add-section-btn'),
  mapViewBtn: document.getElementById('map-view-btn'),
  sourceBtn: document.getElementById('source-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  dirtyIndicator: document.getElementById('dirty-indicator'),
  dirtyText: document.getElementById('dirty-text'),
};

let lastPathLength = 0;

function render() {
  const { doc, fileName, dirty } = getState();

  el.dirtyIndicator.classList.toggle('is-dirty', Boolean(dirty));
  el.dirtyText.textContent = !doc ? 'No document loaded' : dirty ? `${fileName} — unsaved changes` : `${fileName} — up to date`;
  el.sourceBtn.disabled = !doc;
  el.addSectionBtn.disabled = !doc;
  el.mapViewBtn.disabled = !doc;

  if (!doc) {
    el.emptyState.hidden = false;
    el.sectionView.hidden = true;
    el.sidebar.innerHTML = '';
    el.breadcrumb.innerHTML = '';
    lastPathLength = 0;
    return;
  }

  el.emptyState.hidden = true;
  el.sectionView.hidden = false;

  // A note/title edit fires a store update on every autosave tick. If the user is
  // still typing in a field inside the card grid, rebuilding that DOM out from under
  // them would drop focus, jump the cursor, and swallow whatever they type next — so
  // skip the rebuild entirely until they click away. Nothing else changes while typing
  // a note (sidebar/breadcrumb reflect headings, not note text), so this is always safe.
  const active = document.activeElement;
  if (active && el.sectionView.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    return;
  }

  const node = getSelectedNode();
  const path = getSelectedPath();
  if (!node) return;

  renderSidebar(el.sidebar, doc, path.map((n) => n.id), selectSection);
  renderBreadcrumb(el.breadcrumb, path, doc.id, fileName, selectSection);

  const direction = path.length >= lastPathLength ? 'forward' : 'back';
  lastPathLength = path.length;
  animatedSwap(el.sectionView, (container) => renderSectionView(container, node), direction);
}

subscribe(render);
render();

function loadFromText(text, fileName, fileHandle = null) {
  try {
    const doc = parseMarkdown(text);
    if (!doc.children.length && !doc.bodyMarkdown.trim()) {
      showToast('That file has no headings or content — nothing to show.', { type: 'error' });
      return;
    }
    loadDocument({ doc, fileName, fileHandle });
    showToast(`Loaded ${fileName}`);
  } catch (err) {
    console.error(err);
    showToast(`Could not parse ${fileName}: ${err.message}`, { type: 'error' });
  }
}

el.openFileBtn.addEventListener('click', async () => {
  if (supportsFileSystemAccess) {
    try {
      const picked = await openFilePicker();
      if (picked) loadFromText(picked.text, picked.fileName, picked.handle);
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Could not open file: ${err.message}`, { type: 'error' });
    }
  } else {
    el.fileInput.click();
  }
});

el.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await readFile(file);
  loadFromText(text, file.name);
  el.fileInput.value = '';
});

el.samplesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.samplesDropdown.hidden = !el.samplesDropdown.hidden;
});
document.addEventListener('click', (e) => {
  if (!el.samplesDropdown.hidden && !e.target.closest('.samples-menu')) el.samplesDropdown.hidden = true;
});

async function loadSample(path) {
  try {
    const text = await fetchSample(path);
    loadFromText(text, path);
  } catch (err) {
    showToast(err.message, { type: 'error' });
  }
}

el.samplesDropdown.querySelectorAll('button[data-sample]').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadSample(btn.dataset.sample);
    el.samplesDropdown.hidden = true;
  });
});
el.emptySampleBtn.addEventListener('click', () => loadSample('sample.md'));

el.addSectionBtn.addEventListener('click', openAddSectionModal);
el.mapViewBtn.addEventListener('click', openMapView);
el.sourceBtn.addEventListener('click', openSourcePanel);
el.settingsBtn.addEventListener('click', openSettingsPanel);
el.sidebarToggle.addEventListener('click', () => {
  const isNarrowViewport = window.matchMedia('(max-width: 860px)').matches;
  el.sidebar.classList.toggle(isNarrowViewport ? 'sidebar-open' : 'sidebar-collapsed');
});

['dragover', 'drop'].forEach((evt) => window.addEventListener(evt, (e) => e.preventDefault()));
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    showToast('Only .md / .markdown / .txt files are supported.', { type: 'error' });
    return;
  }
  const text = await readFile(file);
  loadFromText(text, file.name);
});
