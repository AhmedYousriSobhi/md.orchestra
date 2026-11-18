// The only module that touches acquireVsCodeApi(). In Electron, Android and
// the browser it is absent, `isVSCode` is false and nothing here does
// anything. See vscode-extension/editorProvider.js for the message protocol.
export const isVSCode = typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function';

// acquireVsCodeApi() may be called exactly once per webview load.
const api = isVSCode ? window.acquireVsCodeApi() : null;

let seq = 0;
const pending = new Map();
const handlers = new Set();

export function post(message) {
  if (api) api.postMessage(message);
}

/** Promise-based RPC to the extension host: resolves with its `result`, rejects with its `error`. */
export function request(op, payload = {}) {
  if (!api) return Promise.reject(new Error('Not running inside VS Code'));
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    api.postMessage({ type: 'request', id, op, ...payload });
  });
}

/** Registers a handler for every host message that isn't an RPC response. Returns an unsubscribe function. */
export function onHostMessage(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

if (isVSCode) {
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'response') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.result);
      return;
    }
    handlers.forEach((fn) => {
      try { fn(msg); } catch (err) { console.error('VS Code host message handler failed', err); }
    });
  });
}

/** Webview state that survives the webview being hidden and shown again (never holds the API key). */
export const vscodeState = {
  get: () => (api && api.getState()) || {},
  set: (patch) => { if (api) api.setState({ ...((api.getState()) || {}), ...patch }); },
};
