import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { parseGithubRepoInput } from '../core/githubIO.js';

let overlayEl = null;

/**
 * Asks for a public GitHub repo (as `owner/repo`, a full github.com URL, or
 * an owner/repo.git remote) and an optional branch, then hands both to
 * `onLoad(owner, repo, branch)`. Unlike openNewFileModal, this stays open
 * and shows the error inline on failure (a wrong repo name/typo is the
 * expected first outcome at least once, not an edge case) rather than
 * closing and leaving the user to reopen it from scratch.
 */
export function openGithubModal({ onLoad }) {
  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const repoInput = h('input', { type: 'text', class: 'settings-input', placeholder: 'owner/repo, or a github.com URL' });
  const branchInput = h('input', { type: 'text', class: 'settings-input', placeholder: 'default branch' });
  const errorEl = h('p', { class: 'settings-help', style: 'display:none; color:#dc2626;' });
  const loadBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Load repo');

  const setBusy = (busy) => {
    loadBtn.disabled = busy;
    loadBtn.textContent = busy ? 'Loading…' : 'Load repo';
  };
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  };

  const submit = async () => {
    const parsed = parseGithubRepoInput(repoInput.value);
    if (!parsed) {
      showError('Enter it as "owner/repo" or paste a github.com URL.');
      return;
    }
    errorEl.style.display = 'none';
    setBusy(true);
    try {
      await onLoad(parsed.owner, parsed.repo, parsed.branch || branchInput.value.trim() || null);
      closeOverlay(overlayEl);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const panel = h('div', { class: 'insight-panel add-section-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '🐙 Open a GitHub repo'),
        h('div', { class: 'insight-subtitle' }, 'Browse a public repo’s Markdown files — read-only for now.'),
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    h('div', { class: 'insight-body' }, [
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Repository'),
        repoInput,
      ]),
      h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Branch (optional)'),
        branchInput,
      ]),
      errorEl,
      loadBtn,
    ]),
  ]);

  repoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  branchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  loadBtn.addEventListener('click', submit);

  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);
  repoInput.focus();
}
