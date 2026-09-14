const MAX_CONTEXT_CHARS = 6000;

export const INSIGHT_SYSTEM = 'You are a concise technical editor helping a reader understand one section of a larger document. Always respond with the exact JSON shape requested, nothing else.';

export function buildInsightPrompt(node, breadcrumbTitles, mainMarkdown) {
  const path = breadcrumbTitles.join(' › ') || node.title;
  const content = (mainMarkdown || '').slice(0, MAX_CONTEXT_CHARS);
  return `Section path: ${path}
Section content:
"""
${content || '(this section has no body text of its own)'}
"""

Respond ONLY with JSON (no prose, no markdown fences), matching exactly:
{
  "summary": "one or two plain-English sentences summarizing this section",
  "clarity_notes": ["up to 3 short observations about what might confuse or mislead a reader; empty array if it's already clear"],
  "suggestion": "a short Markdown addition (a clarifying paragraph, missing caveat, or definition) that would genuinely improve this section if appended to it, or an empty string if nothing is missing"
}`;
}

export function buildDeepDivePrompt(node, breadcrumbTitles, mainMarkdown, question) {
  const path = breadcrumbTitles.join(' › ') || node.title;
  const content = (mainMarkdown || '').slice(0, MAX_CONTEXT_CHARS);
  return `Section path: ${path}
Section content:
"""
${content || '(this section has no body text of its own)'}
"""

The reader wants to understand more about: "${question}"

Write a focused Markdown explanation (a short paragraph or two, and/or a bullet list; no top-level heading) that answers this, using the section content as context plus general knowledge. Return plain Markdown only — no JSON, no preamble, no closing remarks.`;
}
