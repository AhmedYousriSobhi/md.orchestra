// Builds the webview's HTML from media/index.html (the exact file Electron
// and Android load, copied in by `npm run vscode:sync`), without editing
// index.html itself:
//  - every relative src/href is rewritten through webview.asWebviewUri();
//  - a strict Content-Security-Policy is injected as the first <head> child;
//  - every <script> (the two inline ones included) gets a per-load nonce;
//  - css/vscode.css (theme mapping + hosted-mode hiding) is appended.
const crypto = require('crypto');
const vscode = require('vscode');

function buildCsp(webview, nonce) {
  return [
    "default-src 'none'",
    // https: lets a document show remote images, as it does on Electron and
    // Android. data: covers images pasted by the app (js/ui/imageAttach.js).
    `img-src ${webview.cspSource} data: https:`,
    // mermaid injects <style> blocks into its SVG output.
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    // The Claude call goes through the extension host (aiProxy.js) and the
    // GitHub button is hidden, so the webview itself never needs the network.
    "connect-src 'none'",
  ].join('; ');
}

function renderHtml(rawHtml, webview, mediaRoot) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const toUri = (relPath) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, ...relPath.split('/'))).toString();
  let html = rawHtml.replace(
    /\b(src|href)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+)"/gi,
    (_m, attr, relPath) => `${attr}="${toUri(relPath)}"`,
  );
  html = html.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
  html = html.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="${buildCsp(webview, nonce)}">`);
  html = html.replace(/<\/head>/i, `<link rel="stylesheet" href="${toUri('css/vscode.css')}">\n</head>`);
  return html;
}

async function buildWebviewHtml(webview, mediaRoot) {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, 'index.html'));
  return renderHtml(Buffer.from(bytes).toString('utf8'), webview, mediaRoot);
}

module.exports = { buildWebviewHtml, renderHtml, buildCsp };
