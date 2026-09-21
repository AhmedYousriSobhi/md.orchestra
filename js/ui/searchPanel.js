import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { searchWorkspace } from '../core/searchIndex.js';

let overlayEl = null;

const MATCH_LABEL = { filename: 'filename', heading: 'heading', tag: 'tag', body: 'text' };

/**
 * A command-palette-style search across every currently open folder
 * (see core/searchIndex.js — reads and caches a file's content lazily,
 * the first time it's actually searched, not eagerly on folder open).
 * `workspaces` is state/workspace.js's getWorkspaces() result;
 * `onOpenFile(rootName, relPath, anchor)` is main.js's openWorkspaceFile.
 */
export function openSearchPanel({ workspaces, onOpenFile }) {
  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const input = h('input', {
    type: 'text', class: 'settings-input search-input', placeholder: 'Search filenames, headings, tags, and content…',
  });
  const resultsEl = h('div', { class: 'search-results' });

  function showMessage(text) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(h('p', { class: 'search-empty' }, text));
  }

  function renderResults(results, query) {
    resultsEl.innerHTML = '';
    if (!results.length) { showMessage(`No matches for "${query}".`); return; }
    results.forEach((r) => {
      resultsEl.appendChild(h('button', {
        type: 'button',
        class: 'search-result',
        onClick: () => { closeOverlay(overlayEl); onOpenFile(r.rootName, r.relPath, r.anchor); },
      }, [
        h('span', { class: 'search-result-head' }, [
          h('span', { class: 'search-result-name' }, r.name),
          h('span', { class: 'search-result-meta' }, workspaces.length > 1 ? `${r.rootName} · ${MATCH_LABEL[r.matchType]}` : MATCH_LABEL[r.matchType]),
        ]),
        r.snippet ? h('span', { class: 'search-result-snippet' }, r.snippet) : null,
      ]));
    });
  }

  // Guards against a slower, earlier search's results landing after a
  // faster, later one's — each keystroke can outrace the previous
  // keystroke's own lazy file reads, so only the most recently started
  // search is allowed to actually paint the list.
  let seq = 0;
  async function runSearch() {
    const query = input.value.trim();
    const mySeq = ++seq;
    if (!query) { resultsEl.innerHTML = ''; return; }
    if (!workspaces.length) { showMessage('Open a folder first — search covers open folders, not standalone files.'); return; }
    showMessage('Searching…');
    const perWorkspace = await Promise.all(
      workspaces.map((ws) => searchWorkspace(ws.rootName, [...ws.files.values()], query)),
    );
    if (mySeq !== seq) return;
    renderResults(perWorkspace.flat(), query);
  }

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      runSearch();
    }
  });

  const panel = h('div', { class: 'insight-panel search-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '🔍 Search'),
        h('div', { class: 'insight-subtitle' }, 'Across every open folder — filenames, headings, tags, and content.'),
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'insight-body search-body' }, [input, resultsEl]),
  ]);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  input.focus();
}

export function closeSearchPanel() {
  if (overlayEl) closeOverlay(overlayEl);
}
