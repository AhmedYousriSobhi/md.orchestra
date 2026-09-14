import { h } from '../utils/dom.js';
import { openOverlay, closeOverlay } from './transitions.js';
import { callClaude, extractJson } from '../ai/client.js';
import { buildInsightPrompt, buildDeepDivePrompt, INSIGHT_SYSTEM } from '../ai/prompts.js';
import { getAiSettings } from '../ai/settings.js';
import { splitBody, withAiInsert } from '../markdown/markers.js';
import { renderMarkdownToSafeHtml } from '../markdown/render.js';
import { updateNode } from '../state/store.js';
import { showToast } from './toast.js';

let overlayEl = null;

function loadingBody() {
  return h('div', { class: 'insight-loading' }, [
    h('div', { class: 'spinner' }),
    h('span', {}, 'Asking Claude…'),
  ]);
}

function errorBody(message, onRetry) {
  return h('div', { class: 'insight-error' }, [
    h('p', {}, `⚠️ ${message}`),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: onRetry }, 'Try again'),
  ]);
}

/** Open the AI insight popup for `node`. `breadcrumbTitles` is used for prompt context. */
export function openInsightModal(node, breadcrumbTitles) {
  const settings = getAiSettings();
  if (overlayEl) overlayEl.remove();
  overlayEl = h('div', { class: 'overlay insight-overlay', hidden: true });
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(overlayEl); });

  const body = h('div', { class: 'insight-body' });
  const panel = h('div', { class: 'insight-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'side-panel-head' }, [
      h('div', {}, [
        h('h2', {}, '✨ Understand this section'),
        h('div', { class: 'insight-subtitle' }, breadcrumbTitles.join(' › ') || node.title),
      ]),
      h('button', { class: 'code-btn code-btn-close', type: 'button', onClick: () => closeOverlay(overlayEl) }, 'Close ✕'),
    ]),
    body,
  ]);
  overlayEl.appendChild(panel);
  document.body.appendChild(overlayEl);
  openOverlay(overlayEl);

  runInsight(node, breadcrumbTitles, settings, body);
}

async function runInsight(node, breadcrumbTitles, settings, body) {
  body.innerHTML = '';
  body.appendChild(loadingBody());
  const { main } = splitBody(node.bodyMarkdown);
  try {
    const prompt = buildInsightPrompt(node, breadcrumbTitles, main);
    const text = await callClaude({ apiKey: settings.apiKey, model: settings.model, system: INSIGHT_SYSTEM, prompt });
    const result = extractJson(text);
    renderInsightResult(node, breadcrumbTitles, settings, body, result);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(errorBody(err.message, () => runInsight(node, breadcrumbTitles, settings, body)));
  }
}

function renderInsightResult(node, breadcrumbTitles, settings, body, result) {
  body.innerHTML = '';

  const clarityItems = (result.clarity_notes || []).map((note) => h('li', {}, note));
  const claritySection = clarityItems.length
    ? h('div', { class: 'insight-section' }, [
        h('h3', {}, 'Might confuse a reader'),
        h('ul', {}, clarityItems),
      ])
    : null;

  const summarySection = h('div', { class: 'insight-section' }, [
    h('h3', {}, 'Summary'),
    h('p', {}, result.summary || '(no summary returned)'),
  ]);

  const sections = [summarySection];
  if (claritySection) sections.push(claritySection);

  if (result.suggestion && result.suggestion.trim()) {
    const previewEl = h('div', { class: 'insight-suggestion-preview', html: renderMarkdownToSafeHtml(result.suggestion) });
    sections.push(h('div', { class: 'insight-section' }, [
      h('h3', {}, 'Suggested addition'),
      previewEl,
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onClick: (e) => {
          const nextBody = withAiInsert(node.bodyMarkdown, result.suggestion);
          updateNode(node.id, { bodyMarkdown: nextBody });
          e.target.textContent = 'Inserted ✓';
          e.target.disabled = true;
          showToast('Suggestion inserted into the section');
        },
      }, 'Insert into document'),
    ]));
  }

  sections.push(buildDeepDiveSection(node, breadcrumbTitles, settings));

  sections.forEach((s) => body.appendChild(s));
}

function buildDeepDiveSection(node, breadcrumbTitles, settings) {
  const input = h('input', { type: 'text', class: 'settings-input', placeholder: 'e.g. "why is this threshold used?"' });
  const resultBox = h('div', { class: 'insight-deepdive-result' });

  const askBtn = h('button', {
    class: 'btn btn-ghost',
    type: 'button',
    onClick: async () => {
      const question = input.value.trim();
      if (!question) return;
      resultBox.innerHTML = '';
      resultBox.appendChild(loadingBody());
      try {
        const { main } = splitBody(node.bodyMarkdown);
        const prompt = buildDeepDivePrompt(node, breadcrumbTitles, main, question);
        const text = await callClaude({ apiKey: settings.apiKey, model: settings.model, prompt, maxTokens: 900 });
        resultBox.innerHTML = '';
        const preview = h('div', { class: 'insight-suggestion-preview', html: renderMarkdownToSafeHtml(text) });
        const insertBtn = h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onClick: (e) => {
            const nextBody = withAiInsert(node.bodyMarkdown, text);
            updateNode(node.id, { bodyMarkdown: nextBody });
            e.target.textContent = 'Inserted ✓';
            e.target.disabled = true;
            showToast('Answer inserted into the section');
          },
        }, 'Insert into document');
        resultBox.appendChild(preview);
        resultBox.appendChild(insertBtn);
      } catch (err) {
        resultBox.innerHTML = '';
        resultBox.appendChild(errorBody(err.message, () => askBtn.click()));
      }
    },
  }, 'Ask Claude');

  return h('div', { class: 'insight-section' }, [
    h('h3', {}, 'Ask about something specific'),
    h('div', { class: 'insight-deepdive-row' }, [input, askBtn]),
    resultBox,
  ]);
}
