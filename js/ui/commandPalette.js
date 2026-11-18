import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';

let overlayEl = null;

/**
 * Subsequence fuzzy score of `query` against `text` (case-insensitive):
 * every query character must appear in order. Higher = better; consecutive
 * runs and word-start hits score more, earlier matches break ties. null = no match.
 */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi += 1) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    score += 1;
    if (found === prevMatch + 1) score += 3; // consecutive
    if (found === 0 || /[\s\-_/]/.test(t[found - 1])) score += 2; // word start
    score -= found * 0.01; // earlier is better
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

/** Commands matching `query`, best first (original order when the query is empty). Disabled commands are excluded. */
export function filterCommands(commands, query) {
  const usable = commands.filter((c) => !c.disabled);
  if (!query.trim()) return usable;
  return usable
    .map((c) => ({ c, score: fuzzyScore(query, c.title) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

/**
 * VSCode-style command palette. `commands` is [{ id, title, keys?, disabled?, run }].
 * Type to filter, ↑/↓ to move, Enter to run, Esc to close.
 */
export function openCommandPalette(commands) {
  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay search-overlay command-palette-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const input = h('input', {
    type: 'text', class: 'settings-input search-input', placeholder: 'Type a command…',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'command-palette-list', 'aria-label': 'Command',
  });
  const list = h('div', { class: 'search-results', id: 'command-palette-list', role: 'listbox' });
  let shown = [];
  let active = 0;

  function paint() {
    list.innerHTML = '';
    if (!shown.length) {
      list.appendChild(h('p', { class: 'search-empty' }, 'No matching command.'));
      return;
    }
    shown.forEach((cmd, i) => {
      list.appendChild(h('button', {
        class: `search-result command-palette-item${i === active ? ' command-palette-active' : ''}`,
        type: 'button', role: 'option', 'aria-selected': String(i === active),
        onClick: () => run(cmd),
      }, [
        h('span', { class: 'search-result-name' }, cmd.title),
        cmd.keys ? h('span', { class: 'search-result-meta' }, cmd.keys) : null,
      ]));
    });
    const activeEl = list.children[active];
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function refilter() {
    shown = filterCommands(commands, input.value);
    active = 0;
    paint();
  }

  function run(cmd) {
    closeOverlay(overlayEl);
    // After the overlay starts closing, so a command that opens its own panel
    // isn't immediately covered by this one's close transition.
    setTimeout(() => cmd.run(), 0);
  }

  input.addEventListener('input', refilter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) run(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeOverlay(overlayEl); }
  });

  overlayEl.appendChild(h('div', { class: 'insight-panel search-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, [
    h('div', { class: 'insight-body search-body' }, [input, list]),
  ]));
  document.body.appendChild(overlayEl);
  refilter();
  openOverlay(overlayEl);
  input.focus();
}
