import { h } from '../utils/dom.js';
import { getKnownTags } from '../state/tagIndex.js';

/**
 * A chip-row editor for the whole document's own frontmatter tags
 * (markdown/frontmatter.js) — one per document, not per section, so it's
 * rendered once near the breadcrumb rather than inside cardGrid.js's
 * per-heading cards. Free-form: typing anything and pressing Enter or a
 * comma adds it as a new chip; autocomplete suggests tags already seen
 * elsewhere this session (state/tagIndex.js) as you type, but never
 * restricts what you can actually add.
 *
 * Deliberately a hand-built dropdown rather than a native `<datalist>`:
 * most Android WebViews don't render datalist suggestions at all, which
 * would make autocomplete silently do nothing there — this works
 * identically on desktop and Android since it's just DOM elements and
 * event listeners, no browser-native picker involved.
 */
export function renderTagsEditor(container, tags, onChange) {
  // Adding/removing a tag rebuilds this whole container (simplest correct
  // way to keep the chip row in sync) — if the input had focus going in
  // (the common case: it's what triggered this rebuild by committing a
  // tag), refocus its replacement so adding several tags in a row doesn't
  // require re-clicking into the field each time.
  const hadFocus = container.contains(document.activeElement);
  container.innerHTML = '';

  const chipsWrap = h('div', { class: 'tag-chips' });
  tags.forEach((tag) => {
    chipsWrap.appendChild(h('span', { class: 'tag-chip' }, [
      tag,
      h('button', {
        class: 'tag-chip-remove',
        type: 'button',
        'aria-label': `Remove tag "${tag}"`,
        onClick: () => onChange(tags.filter((t) => t !== tag)),
      }, '×'),
    ]));
  });

  const input = h('input', {
    class: 'tag-input',
    type: 'text',
    placeholder: tags.length ? 'Add another…' : 'Add a tag…',
  });
  const suggestions = h('div', { class: 'tag-suggestions', hidden: true });

  function hideSuggestions() {
    suggestions.hidden = true;
    suggestions.innerHTML = '';
  }

  function commit(rawValue) {
    const value = rawValue.trim();
    input.value = '';
    hideSuggestions();
    if (!value || tags.includes(value)) return;
    onChange([...tags, value]);
  }

  function showSuggestions() {
    const query = input.value.trim().toLowerCase();
    const candidates = getKnownTags().filter((t) => !tags.includes(t) && (!query || t.toLowerCase().includes(query)));
    if (!candidates.length) { hideSuggestions(); return; }
    suggestions.innerHTML = '';
    candidates.slice(0, 8).forEach((t) => {
      suggestions.appendChild(h('button', {
        class: 'tag-suggestion',
        type: 'button',
        // Keeps the input focused through the click (no intervening blur),
        // so commit() below runs exactly once, from this click, instead of
        // racing a blur-triggered commit of whatever partial text the
        // input still held.
        onMousedown: (e) => e.preventDefault(),
        onClick: () => commit(t),
      }, t));
    });
    suggestions.hidden = false;
  }

  input.addEventListener('input', showSuggestions);
  input.addEventListener('focus', showSuggestions);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input.value);
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      onChange(tags.slice(0, -1));
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });
  input.addEventListener('blur', () => {
    // Deferred: a suggestion click's own mousedown already prevented this
    // blur from firing before it, but committing synchronously here would
    // still run ahead of that click's own listener in some browsers.
    setTimeout(() => commit(input.value), 0);
  });

  container.appendChild(h('div', { class: 'tags-editor' }, [
    h('span', { class: 'tags-editor-label', title: 'Tags' }, '🏷️'),
    chipsWrap,
    h('div', { class: 'tag-input-wrap' }, [input, suggestions]),
  ]));
  if (hadFocus) input.focus();
}
