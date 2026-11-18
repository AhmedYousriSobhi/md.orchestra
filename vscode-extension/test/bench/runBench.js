// Typing-cost benchmark for the VS Code editor (not part of `npm test` or
// `npm run test:vscode`). Generates realistic Markdown documents, opens
// each in MD.Orchestra inside a real VS Code, types into the full-text,
// section and note fields, and records per-keystroke webview time,
// input-to-paint latency, long tasks, host apply/echo time, message volume
// and memory. Results: <scratch>/bench-results.json plus a printed table.
//
//   cd vscode-extension && node test/bench/runBench.js
//   MDO_BENCH='{"sizes":[10000,100000],"strategies":[{"mode":"perKeystroke"}]}' node test/bench/runBench.js
//
// Needs a display; ELECTRON_RUN_AS_NODE is cleared here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');
const { generateMarkdown } = require('./genDoc');

delete process.env.ELECTRON_RUN_AS_NODE;

const DEFAULTS = {
  sizes: [10e3, 100e3, 1e6, 5e6],
  targets: ['full', 'section', 'note'],
  strategies: [{ mode: 'perKeystroke' }],
  keys: 30,
  intervalMs: 80,
};

function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const f = (n) => (n === null || n === undefined ? '-' : n >= 100 ? n.toFixed(0) : n.toFixed(1));

function printTable(results) {
  const rows = [['size', 'strategy', 'field', 'sync p50/p95 ms', 'paint p50/p95 ms', 'long tasks (n, max ms)', 'host apply p50/p95', 'host latency p50', 'msgs', 'MB sent', 'landed']];
  for (const r of results) {
    if (r.error) { rows.push([r.size, r.strategy, r.target, r.error]); continue; }
    rows.push([
      `${(r.size / 1e3).toFixed(0)}KB`, r.strategy, r.target,
      `${f(pct(r.web.sync, 50))}/${f(pct(r.web.sync, 95))}`,
      `${f(pct(r.web.paint, 50))}/${f(pct(r.web.paint, 95))}${r.web.paintStalls ? ` (${r.web.paintStalls} stalled)` : ''}`,
      `${r.web.longTasks.length}, ${f(Math.max(0, ...r.web.longTasks))}`,
      `${f(pct(r.host.apply, 50))}/${f(pct(r.host.apply, 95))}`,
      f(pct(r.host.latency, 50)),
      r.web.messages, (r.web.bytes / 1e6).toFixed(1),
      r.landed ? 'yes' : 'NO',
    ]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => String(row[c] ?? '').length)));
  rows.forEach((row) => console.log(row.map((cell, c) => String(cell ?? '').padEnd(widths[c])).join(' | ')));
}

async function main() {
  const config = { ...DEFAULTS, ...(process.env.MDO_BENCH ? JSON.parse(process.env.MDO_BENCH) : {}) };
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mdo-bench-ws-'));
  for (const size of config.sizes) fs.writeFileSync(path.join(ws, `bench-${size}.md`), generateMarkdown(size));
  fs.writeFileSync(path.join(ws, 'other.md'), '# Other\n\nPlaceholder.\n');
  const out = process.env.MDO_BENCH_OUT || path.join(ws, 'bench-results.json');
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  await runTests({
    version: process.env.MDO_VSCODE_VERSION || 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: path.join(__dirname, 'benchSuite.js'),
    launchArgs: [ws, '--disable-extensions', '--no-sandbox', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdo-bench-user-'))}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      ...(process.env.MDO_LAUNCH_ARGS ? process.env.MDO_LAUNCH_ARGS.split(' ') : [])],
    extensionTestsEnv: { MDO_WS: ws, MDO_BENCH_CONFIG: JSON.stringify(config), MDO_BENCH_OUT: out },
  });
  const results = JSON.parse(fs.readFileSync(out, 'utf8'));
  printTable(results);
  console.log(`\nraw results: ${out}`);
}

if (require.main === module) {
  main().catch((err) => { console.error('Benchmark failed:', err); process.exit(1); });
}

module.exports = { pct, printTable };
