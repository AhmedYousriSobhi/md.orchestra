import { escapeHtml, escapeAttr } from '../utils/dom.js';

let mdParser = null;

function getMdParser() {
  if (mdParser) return mdParser;
  if (!window.markdownit) {
    throw new Error('markdown-it failed to load (check network access to the CDN).');
  }
  mdParser = window.markdownit({
    html: true,
    linkify: true,
    breaks: false,
    highlight(str, lang) {
      const langKey = (lang || '').trim().toLowerCase();
      if (langKey === 'mermaid') return ''; // let the default renderer wrap it; render.js post-processes it below
      if (window.hljs) {
        try {
          const result = langKey && window.hljs.getLanguage(langKey)
            ? window.hljs.highlight(str, { language: langKey })
            : window.hljs.highlightAuto(str);
          return `<pre class="code-pre hljs" data-lang="${escapeAttr(langKey || result.language || 'text')}"><code class="hljs language-${escapeAttr(langKey || 'plaintext')}">${result.value}</code></pre>`;
        } catch (err) {
          console.warn('highlight.js failed for block', err);
        }
      }
      return `<pre class="code-pre" data-lang="${escapeAttr(langKey || 'text')}"><code>${escapeHtml(str)}</code></pre>`;
    },
  });
  return mdParser;
}

/** Render Markdown to sanitized HTML. Safe to drop straight into innerHTML. */
export function renderMarkdownToSafeHtml(mdText) {
  const html = getMdParser().render(mdText || '');
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary'],
      ADD_ATTR: ['data-lang', 'target'],
    });
  }
  console.warn('DOMPurify not available — rendering unsanitized HTML.');
  return html;
}

/**
 * Post-process a container after its sanitized HTML has been inserted:
 * turns ```mermaid fences into live diagrams, wires a toolbar (copy /
 * expand) onto every code block, and redirects in-document anchor links
 * (e.g. a Table of Contents built from `[Title](#some-heading)`) to the
 * matching section instead of a dead same-page `#anchor` jump.
 * `onOpenCode` receives {lang, code}; `onNavigate(nodeId)` is called for an
 * internal link whose `#slug` matches something in `slugIndex`.
 */
export function enhanceRenderedContent(container, { onOpenCode, slugIndex, onNavigate } = {}) {
  if (slugIndex && onNavigate) {
    container.querySelectorAll('a[href^="#"]').forEach((a) => {
      const slug = decodeURIComponent(a.getAttribute('href').slice(1));
      const targetId = slugIndex.get(slug);
      if (!targetId) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onNavigate(targetId);
      });
    });
  }

  const mermaidBlocks = container.querySelectorAll('code.language-mermaid');
  mermaidBlocks.forEach((codeEl, i) => {
    const pre = codeEl.closest('pre');
    if (!pre) return;
    const source = codeEl.textContent;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-wrap';
    const graphId = `mermaid-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
    wrap.innerHTML = `<div class="mermaid" id="${graphId}">${escapeHtml(source)}</div>`;
    pre.replaceWith(wrap);
  });

  if (mermaidBlocks.length && window.mermaid) {
    try {
      window.mermaid.run({ nodes: container.querySelectorAll('.mermaid') });
    } catch (err) {
      console.warn('mermaid render failed', err);
    }
  }

  container.querySelectorAll('pre.code-pre').forEach((pre) => {
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = 'true';
    const codeEl = pre.querySelector('code');
    const lang = pre.dataset.lang || 'text';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    toolbar.innerHTML = `
      <span class="code-lang">${escapeHtml(lang)}</span>
      <button type="button" class="code-btn code-copy" title="Copy code">Copy</button>
      <button type="button" class="code-btn code-expand" title="Open in viewer">Expand ⤢</button>`;
    pre.prepend(toolbar);

    toolbar.querySelector('.code-copy').addEventListener('click', async () => {
      const btn = toolbar.querySelector('.code-copy');
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        btn.textContent = 'Copied ✓';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });

    toolbar.querySelector('.code-expand').addEventListener('click', () => {
      if (onOpenCode) onOpenCode({ lang, code: codeEl.textContent });
    });
  });
}
