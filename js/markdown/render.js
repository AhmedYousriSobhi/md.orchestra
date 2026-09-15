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

/**
 * Render Markdown to sanitized HTML. Safe to drop straight into innerHTML —
 * markdown-it runs with `html: true` (raw HTML passthrough in the source is
 * a deliberate feature, e.g. `<details>`), so DOMPurify is not optional
 * hardening here, it's the only thing standing between a Markdown file's
 * own content (or a pasted note) and script execution. If it isn't
 * available (CDN blocked, offline, script failed to load), fail closed:
 * never hand back the raw, unsanitized HTML just because sanitizing it
 * wasn't possible.
 */
export function renderMarkdownToSafeHtml(mdText) {
  const html = getMdParser().render(mdText || '');
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary'],
      ADD_ATTR: ['data-lang', 'target'],
    });
  }
  console.error('DOMPurify not available — refusing to render unsanitized HTML.');
  return `<p class="render-error">Could not safely render this content (DOMPurify failed to load — check network access to the CDN, then reload).</p>`;
}

/**
 * Post-process a container after its sanitized HTML has been inserted:
 * turns ```mermaid fences into live diagrams, wires a toolbar (copy /
 * expand) onto every code block, redirects in-document anchor links (e.g.
 * a Table of Contents built from `[Title](#some-heading)`) to the matching
 * section instead of a dead same-page `#anchor` jump, and — when a
 * workspace (a whole opened directory, see state/workspace.js) is active —
 * redirects a relative link to another Markdown file in it to switching
 * documents in-app instead of a dead/real navigation.
 * `onOpenCode` receives {lang, code}; `onNavigate(nodeId)` is called for an
 * internal link whose `#slug` matches something in `slugIndex`;
 * `onNavigateFile(href)` is called (with the link's original href, so it
 * can resolve both the path and any #anchor together) for a link that isn't
 * a same-page anchor.
 */
export function enhanceRenderedContent(container, {
  onOpenCode, slugIndex, onNavigate, onNavigateFile,
} = {}) {
  container.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      if (!slugIndex || !onNavigate) return;
      const targetId = slugIndex.get(decodeURIComponent(href.slice(1)));
      if (!targetId) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onNavigate(targetId);
      });
    } else if (onNavigateFile) {
      a.addEventListener('click', (e) => {
        if (onNavigateFile(href)) e.preventDefault();
      });
    }
  });

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
      // mermaid.run() is async and returns a promise — a plain try/catch
      // only ever catches a *synchronous* throw from calling it, not a
      // later rejection (e.g. its target nodes getting removed from the
      // DOM mid-render because the user already switched to a different
      // document, which switching documents fast enough now makes a real
      // race rather than a hypothetical one). Left uncaught, that surfaces
      // as an unhandled promise rejection instead of this same warning.
      Promise.resolve(window.mermaid.run({ nodes: container.querySelectorAll('.mermaid') }))
        .catch((err) => console.warn('mermaid render failed', err));
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
