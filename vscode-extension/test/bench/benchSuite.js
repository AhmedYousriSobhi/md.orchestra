// Runs inside the VS Code extension host (see runBench.js).
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const WS = process.env.MDO_WS;
const OUT = process.env.MDO_BENCH_OUT;
const config = JSON.parse(process.env.MDO_BENCH_CONFIG);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function waitFor(fn, timeout, what) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timed out: ${what}`);
}

const label = (variant) => (variant.previewOff ? 'previewClosed' : 'default');

const countX = (text) => text.split('x').length - 1;

async function run() {
  const ext = vscode.extensions.getExtension('md-orchestra-placeholder.md-orchestra');
  const { provider } = (await ext.activate()).test;
  const results = [];
  let n = 0;
  for (const size of config.sizes) {
    const source = path.join(WS, `bench-${size}.md`);
    const text = fs.readFileSync(source, 'utf8');
    const sections = (text.match(/^## Section /gm) || []).length;
    const midSlug = `section-${Math.max(1, Math.floor(sections / 2))}`;
    for (const variant of config.variants) {
      for (const target of config.targets) {
        n += 1;
        const file = path.join(WS, `run-${n}.md`);
        fs.copyFileSync(source, file);
        const uri = vscode.Uri.file(file);
        const entry = { size, actualBytes: text.length, variant: label(variant), target };
        try {
          const t0 = Date.now();
          await vscode.commands.executeCommand('vscode.openWith', uri, 'mdOrchestra.editor');
          const session = await waitFor(() => provider.sessionsFor(uri)[0], 30000, 'session');
          if (!(await provider.waitReady(session, 180000))) throw new Error('webview not ready');
          const req = (op, payload = {}, timeout = 600000) => provider.hostRequest(session, op, payload, timeout);
          await waitFor(async () => (await req('probe', {}, 120000))?.hasDoc, 180000, 'document loaded');
          entry.openMs = Date.now() - t0;
          await req('viewMode', { mode: target === 'full' ? 'full' : 'sections' });
          if (target !== 'full') await req('select', { slug: midSlug });
          if (target === 'note') await req('addNote');
          if (variant.previewOff) await req('closePreview');
          await sleep(1000);
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
          const xBefore = countX(doc.getText());
          session.perf = [];
          session.echoPerf = [];
          session.maxQueued = 0;
          const hostHeap0 = process.memoryUsage().heapUsed;
          const web = await req('bench', { target, keys: config.keys, intervalMs: config.intervalMs });
          if (!web || web.error) throw new Error(web ? web.error : 'bench timed out');
          await waitFor(() => !session.queued, 120000, 'host queue drained');
          entry.web = web;
          entry.host = {
            apply: session.perf.map((p) => p.applyMs),
            latency: session.perf.map((p) => p.latencyMs),
            echo: session.echoPerf.slice(),
            maxQueued: session.maxQueued,
            heapDeltaMB: (process.memoryUsage().heapUsed - hostHeap0) / 1e6,
          };
          entry.landed = countX(doc.getText()) - xBefore === config.keys;
          if (doc.isDirty) await doc.save();
        } catch (err) {
          entry.error = err.message;
        }
        results.push(entry);
        fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
        console.log(`[bench] ${entry.size} ${entry.variant} ${entry.target} ${entry.error || 'done'}`);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await sleep(500);
      }
    }
  }
}

module.exports = { run };
