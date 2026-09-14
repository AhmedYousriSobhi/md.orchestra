const FENCE_LINE_RE = /^(```+|~~~+)(.*)$/;

/** Cheap structural counts used for card badges, computed straight off the raw Markdown. */
export function analyzeContent(mdText) {
  const text = mdText || '';
  let codeBlocks = 0;
  let mermaidBlocks = 0;
  let fenceMarker = null;

  for (const line of text.split('\n')) {
    const m = line.match(FENCE_LINE_RE);
    if (!m) continue;
    if (fenceMarker) {
      // Only a fence of the same character, at least as long, with nothing else on the line, closes it.
      if (m[1][0] === fenceMarker[0] && m[1].length >= fenceMarker.length && m[2].trim() === '') fenceMarker = null;
      continue;
    }
    fenceMarker = m[1];
    if (m[2].trim().toLowerCase() === 'mermaid') mermaidBlocks += 1;
    else codeBlocks += 1;
  }

  // A GFM table separator row, e.g. "| --- | :--: |" or "---|---".
  const tableSepRe = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/gm;
  const tables = (text.match(tableSepRe) || []).length;
  const hasDetails = /<details[\s>]/i.test(text);
  return {
    codeBlocks,
    mermaidBlocks,
    tables,
    hasDetails,
  };
}

/** Rough plain-text excerpt for card previews: strip common Markdown syntax. */
export function toPlainExcerpt(mdText, maxLen = 160) {
  const text = (mdText || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/~~~[\s\S]*?~~~/g, ' [code] ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}
