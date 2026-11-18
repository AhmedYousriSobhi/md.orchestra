// Generates realistic Markdown of roughly `targetBytes`: a title, one
// mermaid block, then repeated sections with prose (inline formatting,
// links), lists, a code block, a quote and a sub-section.
function generateMarkdown(targetBytes) {
  const out = ['# Benchmark document', '', 'Intro paragraph for the whole document.', '', '```mermaid', 'graph TD', '  A[Start] --> B{Choice}', '  B --> C[One]', '  B --> D[Two]', '```', ''];
  let size = out.join('\n').length;
  for (let i = 1; size < targetBytes; i += 1) {
    const block = [
      `## Section ${i}`,
      '',
      `This is paragraph ${i}. It has **bold text**, some \`inline code\`, a [link](other.md) and enough prose to look like a real note about topic ${i}, with a second sentence that keeps going for a while so the paragraph wraps.`,
      '',
      `- first point about ${i}`,
      `- second point with *emphasis*`,
      `- third point`,
      '',
      '```js',
      `function section${i}(input) {`,
      '  const items = input.filter(Boolean);',
      '  return items.map((item, index) => ({ item, index }));',
      '}',
      '```',
      '',
      `> A quoted remark for section ${i}.`,
      '',
      `### Details ${i}`,
      '',
      `More detail for section ${i}, written as a short paragraph.`,
      '',
    ].join('\n');
    out.push(block);
    size += block.length + 1;
  }
  return `${out.join('\n')}\n`;
}

module.exports = { generateMarkdown };
