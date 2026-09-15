export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

export const supportsFileSystemAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export async function openFilePicker() {
  if (!supportsFileSystemAccess) return null;
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
  });
  const file = await handle.getFile();
  const text = await file.text();
  return { handle, fileName: file.name, text };
}

/**
 * Write text back to a previously-opened File System Access handle.
 * `showOpenFilePicker` only grants read access by default — writing requires
 * explicitly requesting 'readwrite' first (this is what actually prompts
 * the browser's "Edit file?" confirmation), otherwise createWritable()
 * throws a NotAllowedError.
 */
export async function writeToHandle(handle, text) {
  if (handle.queryPermission && handle.requestPermission) {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    if (current !== 'granted') {
      const requested = await handle.requestPermission({ mode: 'readwrite' });
      if (requested !== 'granted') {
        throw new Error('Permission to write to this file was not granted.');
      }
    }
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export function downloadText(fileName, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function guessCodeFileExtension(lang) {
  const map = {
    javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh', sh: 'sh',
    json: 'json', yaml: 'yml', yml: 'yml', html: 'html', css: 'css', sql: 'sql',
    go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', ruby: 'rb',
    php: 'php', markdown: 'md', text: 'txt', plaintext: 'txt',
  };
  return map[(lang || '').toLowerCase()] || 'txt';
}
