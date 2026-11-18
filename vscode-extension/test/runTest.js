// Downloads a VS Code build (cached in .vscode-test/) and runs the
// extension-host suite against a throwaway copy of test/fixtures/.
//
// Two launches share one --user-data-dir, so the second ("restart") can
// check what survived a full VS Code restart (spike question S2).
//
// Needs a display (or xvfb-run). ELECTRON_RUN_AS_NODE must not be set, or
// the downloaded VS Code starts as plain Node and the run fails.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

delete process.env.ELECTRON_RUN_AS_NODE;

function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mdo-vscode-ws-'));
  fs.cpSync(path.join(__dirname, 'fixtures'), ws, { recursive: true });
  // A real PNG for the relative-image check (S6).
  fs.copyFileSync(path.join(__dirname, '..', 'media', 'icons', 'icon.png'), path.join(ws, 'img.png'));
  // CRLF and no trailing newline: the byte-identical round-trip check.
  fs.writeFileSync(path.join(ws, 'crlf.md'), '# CRLF title\r\n\r\nFirst line.\r\n\r\n## Second\r\n\r\nTrailing spaces  \r\nno final newline');
  return ws;
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  if (!fs.existsSync(path.join(extensionDevelopmentPath, 'media', 'index.html'))) {
    throw new Error('media/ is missing: run `npm run vscode:sync` at the repo root first.');
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdo-vscode-user-'));
  const ws = makeWorkspace();
  const common = {
    version: process.env.MDO_VSCODE_VERSION || 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, 'suite', 'index.js'),
    launchArgs: [ws, '--disable-extensions', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  };
  await runTests({ ...common, extensionTestsEnv: { MDO_WS: ws, MDO_PHASE: 'main' } });
  await runTests({ ...common, extensionTestsEnv: { MDO_WS: ws, MDO_PHASE: 'restart' } });
}

main().catch((err) => {
  console.error('Extension-host tests failed:', err);
  process.exit(1);
});
