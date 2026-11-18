// Extension-host tests: drive the real MD.Orchestra webview inside a real
// (downloaded) VS Code, through the provider and the webview bridge.
// Webview-side test operations are in js/hostedMode.js (runTestOp) and are
// only honoured when the host runs in ExtensionMode.Test.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vscode = require('vscode');

const WS = process.env.MDO_WS;
const VIEW_TYPE = 'mdOrchestra.editor';
const RESULTS_FILE = path.join(WS || '.', 'results.json');

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function waitFor(fn, { timeout = 15000, interval = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function record(key, value) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch { /* first */ }
  all[key] = value;
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2));
  console.log(`       [record] ${key} = ${JSON.stringify(value)}`);
}

let testApi;
async function api() {
  if (testApi) return testApi;
  const ext = vscode.extensions.getExtension('md-orchestra-placeholder.md-orchestra');
  assert.ok(ext, 'extension is installed in the development host');
  testApi = (await ext.activate()).test;
  assert.ok(testApi, 'test API is exposed in ExtensionMode.Test');
  return testApi;
}

let copyCounter = 0;
/** A fresh copy of a fixture, so every test starts from a clean, unopened file. */
function fresh(fixture = 'doc.md') {
  copyCounter += 1;
  const name = `${path.basename(fixture, '.md')}-${process.env.MDO_PHASE}-${copyCounter}.md`;
  fs.copyFileSync(path.join(WS, fixture), path.join(WS, name));
  return vscode.Uri.file(path.join(WS, name));
}

/** Opens `uri` in MD.Orchestra and resolves with its ready session. */
async function openEditor(uri, column) {
  const { provider } = await api();
  const before = new Set(provider.sessionsFor(uri));
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, column);
  const session = await waitFor(() => provider.sessionsFor(uri).find((s) => !before.has(s)), { what: 'a new editor session' });
  assert.ok(await provider.waitReady(session, 30000), 'webview posted ready (its ES modules loaded)');
  return session;
}

function hostRequest(session, op, payload = {}) {
  return testApi.provider.hostRequest(session, op, payload, 10000);
}

function docFor(uri) {
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
}

const countSent = (session, type) => session.sent.filter((m) => m.type === type).length;
const countReceived = (session, type) => session.received.filter((m) => m.type === type).length;

async function closeAll() {
  // Never leave a dirty document behind: closing one would open a modal
  // "save changes?" dialog that blocks the run.
  for (const d of vscode.workspace.textDocuments) if (d.isDirty && d.uri.scheme === 'file') await d.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(200);
}

const tests = [];
const test = (name, fn, phase = 'main') => tests.push({ name, fn, phase });

test('S1: webview loads index.html + ES-module graph under the CSP, no bundler', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  const probe = await hostRequest(session, 'probe');
  assert.ok(probe, 'webview answered a host request');
  assert.strictEqual(probe.hasDoc, true);
  assert.strictEqual(probe.fileName, path.basename(uri.fsPath));
  assert.deepStrictEqual(probe.vendors, {
    hljs: true, markdownit: true, DOMPurify: true, mermaid: true,
  });
  // Set as early as possible in the run, so it has the longest time to be
  // flushed to disk before this VS Code instance exits (S2 restart check).
  const early = await hostRequest(session, 'storage', { set: true, key: 'mdo.s2.early', value: 'persisted' });
  record('S2-origin-main', early.origin);
  assert.match(probe.bodyClasses, /hosted-vscode/);
  assert.match(probe.bodyClasses, /vscode-(light|dark|high-contrast)/);
  assert.deepStrictEqual(probe.errors, []);
  record('S1', { ready: true, vendors: probe.vendors, bodyClasses: probe.bodyClasses });
  await closeAll();
});

test('hosted mode hides Explorer, file/folder/GitHub/add-file/Changes/search UI', async () => {
  const session = await openEditor(fresh());
  const probe = await hostRequest(session, 'probe');
  assert.strictEqual(probe.explorerVisible, false);
  assert.strictEqual(probe.openFileVisible, false);
  await closeAll();
});

test('S5 + S6: mermaid, highlight.js, DOMPurify and a relative image render with zero CSP violations', async () => {
  const session = await openEditor(fresh());
  assert.strictEqual(await hostRequest(session, 'select', { slug: 'rendering' }), 'rendering');
  const probe = await waitFor(async () => {
    const p = await hostRequest(session, 'probe');
    const img = p.images.find((i) => /img\.png$/.test(i.src || ''));
    return p.mermaidSvgs > 0 && p.highlighted > 0 && img && img.loaded ? p : null;
  }, { what: 'mermaid SVG + highlighted code + loaded image', timeout: 20000 });
  const img = probe.images.find((i) => /img\.png$/.test(i.src));
  assert.ok(!/^img\.png$/.test(img.src), 'relative src was rewritten to a webview URI');
  assert.deepStrictEqual(probe.cspViolations, []);
  assert.deepStrictEqual(session.diagnostics.filter((d) => d.kind === 'csp'), []);
  assert.deepStrictEqual(probe.errors, []);
  record('S5', { mermaidSvgs: probe.mermaidSvgs, highlighted: probe.highlighted, cspViolations: probe.cspViolations });
  record('S6', { imageSrc: img.src, loaded: img.loaded });
  await closeAll();
});

test('untouched open + save is byte-identical (LF fixture and CRLF/no-final-newline fixture)', async () => {
  for (const fixture of ['doc.md', 'crlf.md']) {
    const uri = fresh(fixture);
    const before = fs.readFileSync(uri.fsPath);
    const session = await openEditor(uri);
    await sleep(1500);
    assert.strictEqual(countReceived(session, 'edit'), 0, `${fixture}: no edit posted on open`);
    const doc = docFor(uri);
    assert.strictEqual(doc.isDirty, false, `${fixture}: not dirty after open`);
    await vscode.commands.executeCommand('workbench.action.files.save');
    await doc.save();
    assert.ok(before.equals(fs.readFileSync(uri.fsPath)), `${fixture}: bytes identical after open + save`);
    await closeAll();
  }
});

test('S4: webview edit -> one minimal WorkspaceEdit, tab dirty, no echo; save writes disk and clears dirty', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  const doc = docFor(uri);
  const original = doc.getText();
  const changes = [];
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === doc && e.contentChanges.length) changes.push(...e.contentChanges);
  });
  const sentExternalBefore = countSent(session, 'externalChange');
  const added = '\nAdded from the webview.\n';
  assert.strictEqual(await hostRequest(session, 'appendToSelected', { text: added }), true);
  await waitFor(() => doc.getText().includes('Added from the webview.'), { what: 'edit applied to the TextDocument' });
  await sleep(500);
  sub.dispose();
  assert.strictEqual(changes.length, 1, 'exactly one content change');
  assert.strictEqual(changes[0].rangeLength, 0, 'pure insertion, not a whole-document replace');
  // The minimal diff may shift the insertion point across a shared newline,
  // but it must insert exactly the growth of the document and nothing more.
  assert.strictEqual(changes[0].text.length, doc.getText().length - original.length, 'only the added text was sent');
  assert.ok(changes[0].text.length <= added.length);
  assert.strictEqual(doc.isDirty, true, 'tab is dirty');
  assert.strictEqual(countSent(session, 'externalChange'), sentExternalBefore, 'own edit was not echoed back');
  assert.strictEqual(countReceived(session, 'edit'), 1, 'webview did not re-send after the host applied its edit');
  await waitFor(async () => (await hostRequest(session, 'probe')).dirty === true, { what: 'webview dirty=true' });

  assert.ok(await doc.save());
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), doc.getText(), 'disk matches the document');
  assert.strictEqual(doc.isDirty, false);
  await waitFor(async () => (await hostRequest(session, 'probe')).dirty === false, { what: 'webview dirty=false after save' });
  await closeAll();
});

test('S4: an edit in a split plain text editor reaches the webview, keeps the selection, and is not echoed back', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  assert.strictEqual(await hostRequest(session, 'select', { slug: 'second-section' }), 'second-section');
  const doc = docFor(uri);
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  const editsBefore = countReceived(session, 'edit');
  await editor.edit((b) => b.insert(doc.positionAt(doc.getText().length), '\n## Typed in the text editor\n\nHello.\n'));
  await waitFor(() => countSent(session, 'externalChange') > 0, { what: 'externalChange posted' });
  await sleep(800);
  const probe = await hostRequest(session, 'probe');
  assert.strictEqual(probe.selectedSlug, 'second-section', 'selection preserved by heading slug');
  assert.strictEqual(countReceived(session, 'edit'), editsBefore, 'webview did not answer with an edit (no loop)');
  assert.strictEqual(countSent(session, 'externalChange'), 1);
  await closeAll();
});

test('S4: two MD.Orchestra editors on one document stay in sync without echo', async () => {
  const uri = fresh();
  const a = await openEditor(uri, vscode.ViewColumn.One);
  const b = await openEditor(uri, vscode.ViewColumn.Two);
  const doc = docFor(uri);
  await hostRequest(a, 'appendToSelected', { text: '\nFrom editor A.\n' });
  await waitFor(() => doc.getText().includes('From editor A.'), { what: 'A edit applied' });
  await waitFor(() => countSent(b, 'externalChange') > 0, { what: 'B notified' });
  await sleep(500);
  assert.strictEqual(countSent(a, 'externalChange'), 0, 'A got no echo');
  assert.strictEqual(countReceived(b, 'edit'), 0, 'B did not write back');
  await closeAll();
});

test('S4: VS Code undo/redo and Revert File act on the webview edit', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  const doc = docFor(uri);
  const original = doc.getText();
  await hostRequest(session, 'appendToSelected', { text: '\nTo be undone.\n' });
  await waitFor(() => doc.getText().includes('To be undone.'), { what: 'edit applied' });

  await vscode.commands.executeCommand('undo');
  let undone = false;
  try { await waitFor(() => doc.getText() === original, { timeout: 4000 }); undone = true; } catch { /* recorded below */ }
  let redone = false;
  if (undone) {
    await vscode.commands.executeCommand('redo');
    try { await waitFor(() => doc.getText().includes('To be undone.'), { timeout: 4000 }); redone = true; } catch { /* recorded */ }
  }
  record('S4-undo-redo-command', { undone, redone });
  assert.ok(undone, 'the undo command reverted the webview edit');
  assert.ok(redone, 'the redo command re-applied it');

  await hostRequest(session, 'appendToSelected', { text: '\nTo be reverted.\n' });
  await waitFor(() => doc.isDirty && doc.getText().includes('To be reverted.'), { what: 'dirty edit' });
  const externalBefore = countSent(session, 'externalChange');
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor(() => !doc.isDirty, { what: 'revert' });
  assert.strictEqual(doc.getText(), fs.readFileSync(uri.fsPath, 'utf8'));
  await waitFor(() => countSent(session, 'externalChange') > externalBefore, { what: 'webview told about the revert' });
  await waitFor(async () => (await hostRequest(session, 'probe')).dirty === false, { what: 'webview clean' });
  await closeAll();
});

test('Save right after typing (debounced edit still pending) saves the latest text', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  assert.strictEqual(await hostRequest(session, 'viewMode', { mode: 'full' }), true);
  assert.strictEqual(await hostRequest(session, 'typePending', { text: '\nTYPED-JUST-BEFORE-SAVE\n' }), true);
  const doc = docFor(uri);
  assert.ok(!doc.getText().includes('TYPED-JUST-BEFORE-SAVE'), 'edit is still pending in the webview');
  assert.strictEqual(doc.isDirty, false, 'document is still clean: the edit has not reached VS Code yet');
  // What Ctrl/Cmd+S runs (TextDocument.save() is a no-op on a clean document).
  await vscode.commands.executeCommand('workbench.action.files.save');
  assert.ok(fs.readFileSync(uri.fsPath, 'utf8').includes('TYPED-JUST-BEFORE-SAVE'), 'onWillSave flushed it to disk');
  await sleep(300);
  assert.strictEqual(doc.isDirty, false);
  await closeAll();
});

test('Switching tabs right after typing (debounced edit still pending) does not lose it', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  await hostRequest(session, 'viewMode', { mode: 'full' });
  assert.strictEqual(await hostRequest(session, 'typePending', { text: '\nTYPED-BEFORE-TAB-SWITCH\n' }), true);
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(WS, 'other.md')), { preview: false, viewColumn: vscode.ViewColumn.One });
  const doc = docFor(uri);
  let landed = false;
  try { await waitFor(() => doc.getText().includes('TYPED-BEFORE-TAB-SWITCH'), { timeout: 3000 }); landed = true; } catch { /* recorded */ }
  record('pending-edit-on-tab-switch', { landed });
  assert.ok(landed, 'the pending edit reached the document when the tab was hidden');
  await closeAll();
});

test('With files.autoSave=afterDelay, an autosave while typing keeps focus in the live text field', async () => {
  const files = vscode.workspace.getConfiguration('files');
  await files.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Global);
  await files.update('autoSaveDelay', 200, vscode.ConfigurationTarget.Global);
  try {
    const uri = fresh();
    const session = await openEditor(uri);
    await hostRequest(session, 'viewMode', { mode: 'full' });
    await hostRequest(session, 'typePending', { text: '\nAUTOSAVE-1\n' });
    const doc = docFor(uri);
    await waitFor(() => fs.readFileSync(uri.fsPath, 'utf8').includes('AUTOSAVE-1'), { what: 'autosave wrote the edit', timeout: 8000 });
    await sleep(500);
    const probe = await hostRequest(session, 'probe');
    record('autosave-focus', probe.active);
    assert.strictEqual(probe.active.tag, 'TEXTAREA', 'focus is still in a text field');
    assert.strictEqual(probe.active.connected, true, 'and that field is still in the page');
    assert.ok(!doc.isDirty);
  } finally {
    await files.update('autoSave', undefined, vscode.ConfigurationTarget.Global);
    await files.update('autoSaveDelay', undefined, vscode.ConfigurationTarget.Global);
    await closeAll();
  }
});

test('A webview edit based on stale text never silently reverts a newer external change', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  const doc = docFor(uri);
  const staleBase = doc.getText();
  const external = new vscode.WorkspaceEdit();
  external.insert(uri, new vscode.Position(0, 0), 'EXTERNAL LINE\n');
  await vscode.workspace.applyEdit(external);
  // The webview had not yet seen the external change when it sent this.
  const loadSyncId = session.sent.find((m) => m.type === 'load').syncId;
  testApi.provider.onMessage(session, { type: 'edit', syncId: loadSyncId, text: staleBase.replace('Some text in the second section.', 'Some text in the second section. WEBVIEW') }, () => ({}));
  await sleep(800);
  const text = doc.getText();
  record('stale-edit', { externalKept: text.includes('EXTERNAL LINE'), webviewKept: text.includes('WEBVIEW') });
  assert.ok(text.includes('EXTERNAL LINE'), 'the external change survived');
  assert.ok(text.includes('WEBVIEW'), 'and so did the non-overlapping webview edit (rebased)');
  // The view is told about the merged text.
  await waitFor(() => session.sent.some((m) => m.type === 'externalChange' && m.text === text), { what: 'merged text sent to the webview' });

  // Overlapping: refused, the document keeps the external change, and the view reloads.
  const before = doc.getText();
  const sync2 = session.sent.filter((m) => m.type === 'externalChange').pop().syncId;
  const overlapping = new vscode.WorkspaceEdit();
  const at = before.indexOf('body.', before.indexOf('Nested body.'));
  overlapping.replace(uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + 'body'.length)), 'BODY-EXTERNAL');
  await vscode.workspace.applyEdit(overlapping);
  const externalCount = session.sent.filter((m) => m.type === 'externalChange').length;
  // The webview rewrote the whole line, overlapping the external change.
  testApi.provider.onMessage(session, { type: 'edit', syncId: sync2, text: before.replace('Nested body.', 'Rewritten in the webview.') }, () => ({}));
  await sleep(800);
  assert.ok(doc.getText().includes('Nested BODY-EXTERNAL.'), 'overlapping stale edit was not applied');
  assert.ok(!doc.getText().includes('Rewritten in the webview.'));
  assert.ok(session.sent.filter((m) => m.type === 'externalChange').length > externalCount, 'view reloaded to the real text');
  record('stale-edit-overlap', { refused: true });
  await vscode.commands.executeCommand('notifications.clearAll');
  await closeAll();
});

test('A relative .md link opens the target in MD.Orchestra', async () => {
  const uri = fresh();
  const session = await openEditor(uri);
  await hostRequest(session, 'select', { slug: 'rendering' });
  await sleep(500);
  assert.strictEqual(await hostRequest(session, 'clickLink', { href: 'other.md' }), true);
  const otherUri = vscode.Uri.file(path.join(WS, 'other.md'));
  const other = await waitFor(() => testApi.provider.sessionsFor(otherUri)[0], { what: 'other.md opened in MD.Orchestra' });
  assert.ok(await testApi.provider.waitReady(other));
  await closeAll();
});

test('S7: Claude call goes through the extension host with the SecretStorage key; key never reaches the webview', async () => {
  const KEY = 'sk-ant-test-0123456789';
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'mock reply' }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { aiProxy, secrets } = await api();
  aiProxy.setApiUrlForTests(`http://127.0.0.1:${server.address().port}/v1/messages`);
  try {
    await aiProxy.setApiKey(secrets, KEY);
    const session = await openEditor(fresh());
    const ok = await hostRequest(session, 'callClaude', { prompt: 'hello' });
    assert.deepStrictEqual(ok, { text: 'mock reply' });
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].headers['x-api-key'], KEY);
    assert.strictEqual(seen[0].body.messages[0].content, 'hello');
    const dump = await hostRequest(session, 'storageDump');
    const everything = JSON.stringify([session.sent, dump]);
    assert.ok(!everything.includes(KEY), 'key absent from every host->webview message and from webview storage/state');

    await aiProxy.clearApiKey(secrets);
    const noKey = await hostRequest(session, 'callClaude', { prompt: 'again' });
    assert.match(noKey.error, /No Claude API key configured/);
    record('S7', { headerKeyMatched: true, keyInWebview: false, mocked: true });
  } finally {
    aiProxy.setApiUrlForTests(null);
    server.close();
    await closeAll();
  }
});

test('S2: webview localStorage vs vscode.setState across hide/show and close/reopen', async () => {
  const uri = fresh();
  let session = await openEditor(uri);
  const set = await hostRequest(session, 'storage', { set: true, key: 'mdo.s2', value: 'persisted' });
  assert.strictEqual(set.value, 'persisted');

  // (a) hide the tab (another editor in the same group), then show it again.
  const readyBefore = countReceived(session, 'ready');
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(WS, 'other.md')), { preview: false, viewColumn: vscode.ViewColumn.One });
  await sleep(800);
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.One);
  await sleep(1500);
  // With retainContextWhenHidden: true the webview is kept alive, not reloaded.
  const reloadedOnShow = countReceived(session, 'ready') > readyBefore;
  const afterShow = await hostRequest(session, 'storage', { key: 'mdo.s2' });

  // (b) close the editor and open it again (a brand new webview).
  await closeAll();
  session = await openEditor(uri);
  const afterReopen = await hostRequest(session, 'storage', { key: 'mdo.s2' });
  record('S2', {
    hideShow: afterShow, reloadedOnShow, closeReopen: afterReopen,
  });
  await closeAll();
});

// Not a valid restart check, kept to document why: under extension tests VS
// Code keeps ALL its storage in memory (`useInMemoryStorage:
// !!extensionTestsLocationURI` in its main process), including the
// application-scope memento in which it keeps each webview's origin. So
// the second launch gets a new webview origin, and an empty localStorage,
// by construction. It is recorded, not asserted; S2 (c)/(d) are on the
// manual checklist in TESTING.md.
test('S2 (restart phase, informational): what a second launch with the same user-data-dir sees', async () => {
  const session = await openEditor(fresh());
  record('S2-restart-harness', await hostRequest(session, 'storage', { key: 'mdo.s2.early' }));
  await closeAll();
}, 'restart');

module.exports = tests;
