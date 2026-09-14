const FENCE_OPEN_RE = /^(```+|~~~+)(\S*)/gm;

/** Cheap structural counts used for card badges, computed straight off the raw Markdown. */
export function analyzeContent(mdText) {
  const text = mdText || '';
  let codeBlocks = 0;
  let mermaidBlocks = 0;
  let match;
  FENCE_OPEN_RE.lastIndex = 0;
  while ((match = FENCE_OPEN_RE.exec(text))) {
    codeBlocks += 1;
    if (match[2].trim().toLowerCase() === 'mermaid') mermaidBlocks += 1;
  }
  // A GFM table separator row, e.g. "| --- | :--: |" or "---|---".
  const tableSepRe = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/gm;
  const tables = (text.match(tableSepRe) || []).length;
  const hasDetails = /<details[\s>]/i.test(text);
  return {
    codeBlocks: codeBlocks - mermaidBlocks,
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
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}
