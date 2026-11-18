const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// #53: an untouched file re-saves byte-for-byte; an edited one keeps its
// line endings and final-newline state.
const CASES = {
  textAboveFirstHeading: 'Intro line right above\n# Title\n\nBody\n',
  noBlankAfterHeading: '# T\nBody right under\n\n## S\nmore\n',
  multipleBlankLines: '# T\n\n\n\nBody\n\n\n## S\n\nx\n',
  trailingSpaces: '# T\n\nline with trailing   \n',
  noFinalNewline: '# T\n\nBody',
  manyFinalNewlines: '# T\n\nBody\n\n\n',
  crlf: '# T\r\n\r\nBody\r\n',
  crlfNoFinalNewline: '# T\r\n\r\nBody',
  closingHashes: '## S ##\n\nBody\n',
  leadingEmptyH1s: '# aCupOfTea\n# AI Tea Lounge\n\nBody\n',
  frontmatter: '---\ntitle: X\ntags: [a, b]\n---\n\n# T\n\nBody\n',
  frontmatterNoBlank: '---\ntags: [a]\n---\n# T\nBody\n',
  codeFence: '# T\n\n```\na\n\n\nb\n```\n',
  empty: '',
  onlyText: 'just text\n',
};

function repoMarkdown() {
  const out = {};
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) return;
    if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) out[path.relative(process.cwd(), p)] = fs.readFileSync(p, 'utf8');
  });
  ['docs', 'tests/fixtures'].forEach((d) => walk(path.join(process.cwd(), d)));
  ['README.md', 'SPEC.md', 'CLAUDE.md', 'CHANGELOG.md', 'TESTING.md'].forEach((f) => { out[f] = fs.readFileSync(f, 'utf8'); });
  return out;
}

const run = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const parser = await import('/js/markdown/parser.js');
  const ser = await import('/js/markdown/serializer.js');
  // eslint-disable-next-line no-new-func
  return new Function('parser', 'ser', 'arg', `return (${src})(parser, ser, arg);`)(parser, ser, a);
}, [fn.toString(), arg]);

test.beforeEach(async ({ page }) => { await page.goto('/index.html'); });

test('every edge case and every Markdown file in the repo round-trips byte-for-byte untouched', async ({ page }) => {
  const all = { ...CASES, ...repoMarkdown() };
  const bad = await run(page, ({ parseMarkdown }, { serializeMarkdown }, files) => Object.entries(files)
    .filter(([, text]) => serializeMarkdown(parseMarkdown(text)) !== text).map(([name]) => name), all);
  expect(bad).toEqual([]);
});

test('an edit is preserved, keeps CRLF and a missing final newline, and untouched sections stay the same', async ({ page }) => {
  const out = await run(page, ({ parseMarkdown }, { serializeMarkdown }) => {
    const edit = (text) => {
      const doc = parseMarkdown(text);
      doc.children[0].bodyMarkdown += ' EDITED';
      return serializeMarkdown(doc);
    };
    return { crlf: edit('# T\r\n\r\nBody\r\n'), noNl: edit('# T\n\nBody'), plain: edit('# T\n\nBody\n') };
  });
  expect(out.crlf).toBe('# T\r\n\r\nBody EDITED\r\n');
  expect(out.noNl).toBe('# T\n\nBody EDITED');
  expect(out.plain).toBe('# T\n\nBody EDITED\n');
});

test('undoing an edit back to the original returns the original bytes; a tags change is written', async ({ page }) => {
  const out = await run(page, ({ parseMarkdown }, { serializeMarkdown }) => {
    const src = 'Intro\n# T\n\n\nBody\n';
    const doc = parseMarkdown(src);
    const original = doc.children[0].bodyMarkdown;
    doc.children[0].bodyMarkdown = 'changed';
    const edited = serializeMarkdown(doc);
    doc.children[0].bodyMarkdown = original;
    const restored = serializeMarkdown(doc);
    const tagged = parseMarkdown(src);
    tagged.tags = ['x'];
    return { edited, restored: restored === src, tagged: serializeMarkdown(tagged) };
  });
  expect(out.edited).toContain('changed');
  expect(out.restored).toBe(true);
  expect(out.tagged.startsWith('---\ntags: [x]\n---')).toBe(true);
});

test('documents not built by parseMarkdown still serialize (normalized)', async ({ page }) => {
  const out = await run(page, (p, { serializeMarkdown }) => serializeMarkdown({
    level: 0, title: 'Document', bodyMarkdown: '', tags: [], frontmatterOtherLines: [],
    children: [{ level: 1, title: 'A', bodyMarkdown: 'x', children: [] }],
  }));
  expect(out).toBe('# A\n\nx\n');
});
