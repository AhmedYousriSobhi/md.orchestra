// A minimal sequential runner (no mocha): each test is an async function;
// any failure makes run() reject, which fails the VS Code test process.
const tests = require('./editor.test');

async function run() {
  const phase = process.env.MDO_PHASE || 'main';
  // MDO_ONLY: a regular expression; run only the tests whose name matches.
  const only = process.env.MDO_ONLY ? new RegExp(process.env.MDO_ONLY) : null;
  const selected = tests.filter((t) => (t.phase || 'main') === phase && (!only || only.test(t.name)));
  let failed = 0;
  for (const t of selected) {
    const started = Date.now();
    try {
      await t.fn();
      console.log(`  ok   ${t.name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${t.name}\n       ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n       ') : err}`);
    }
  }
  console.log(`\n[${phase}] ${selected.length - failed}/${selected.length} passed`);
  if (failed) throw new Error(`${failed} test(s) failed`);
}

module.exports = { run };
