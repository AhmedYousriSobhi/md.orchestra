import { h } from '../utils/dom.js';

// Images are embedded as data: URIs directly in the Markdown — this app has
// no backend/asset store to upload to, so a self-contained ![alt](data:...)
// is what keeps a section portable in one .md file. That does mean a large
// image meaningfully bloats the file; fine for screenshots/diagrams, worth
// keeping in mind for anything bigger.

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Insert `block` at the cursor as its own paragraph — padded with blank
 * lines on whichever side already has content — rather than splicing it
 * into whatever line the cursor happens to sit on. An image reference is
 * a block-level insertion; gluing it onto the end of, say, a table row
 * (the common case: focus() parks the cursor at the end of the existing
 * text) would corrupt that row and stop the image from parsing as one.
 */
function insertBlock(textarea, block) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';

  textarea.value = `${before}${lead}${block}${trail}${after}`;
  const pos = before.length + lead.length + block.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

async function insertImageFile(textarea, file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const dataUrl = await readAsDataUrl(file);
    const alt = file.name.replace(/\.[^./\\]+$/, '') || 'image';
    insertBlock(textarea, `![${alt}](${dataUrl})`);
  } catch (err) {
    console.warn('Could not attach image', err);
  }
}

/** Let an image be pasted or dragged straight into `textarea`, inserted as a Markdown image at the cursor. */
export function wireImageAttach(textarea) {
  textarea.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    insertImageFile(textarea, item.getAsFile());
  });

  textarea.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.items || []).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the window-level "open a dropped .md file" handler also see this
    textarea.classList.add('image-drop-target');
  });
  textarea.addEventListener('dragleave', () => textarea.classList.remove('image-drop-target'));
  textarea.addEventListener('drop', (e) => {
    const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    textarea.classList.remove('image-drop-target');
    insertImageFile(textarea, file);
  });
}

/** A small "📎 Image" button + hidden file input, wired to insert into `textarea` at the cursor. */
export function createAttachImageButton(textarea) {
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) insertImageFile(textarea, file);
    fileInput.value = '';
  });
  const btn = h('button', {
    class: 'code-btn',
    type: 'button',
    title: 'Attach an image',
    onClick: () => fileInput.click(),
  }, '📎 Image');
  return h('span', { class: 'attach-image-btn' }, [btn, fileInput]);
}
