const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'demo-workspace');

/** Absolute path to a file inside tests/fixtures/demo-workspace/. */
function fixturePath(...segments) {
  return path.join(FIXTURES_DIR, ...segments);
}

/**
 * Injected via page.addInitScript() (not page.evaluate() — properties set
 * that way don't survive a reload/navigation, since it's a fresh JS
 * context) to make the app take its Capacitor code paths in an ordinary
 * headless browser, without a real device or emulator. Every plugin method
 * this app actually calls is stubbed; a stub missing one throws inside the
 * app's own click handlers with a real, if confusing, error -- exactly
 * the kind of test-harness artifact this project has hit before, so keep
 * this list in sync with every window.Capacitor.Plugins.* call in js/main.js.
 */
const CAPACITOR_STUB = `
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      ScopedStorage: {
        pickFolder: () => Promise.resolve({ folder: { id: 'stub', name: 'stub' } }),
        readdir: () => Promise.resolve({ entries: [] }),
        // Records every call so tests can assert on them, and can be made
        // to reject (simulating the user backing out of the native picker)
        // via window.__capacitorSaveFileAsCancelled.
        saveFileAs: (opts) => {
          window.__capacitorSaveFileAsCalls = window.__capacitorSaveFileAsCalls || [];
          window.__capacitorSaveFileAsCalls.push(opts);
          if (window.__capacitorSaveFileAsCancelled) return Promise.reject(new Error('User cancelled'));
          return Promise.resolve({ uri: 'content://stub/' + opts.suggestedName, name: opts.suggestedName });
        },
        writeFileAtUri: (opts) => {
          window.__capacitorWriteFileAtUriCalls = window.__capacitorWriteFileAtUriCalls || [];
          window.__capacitorWriteFileAtUriCalls.push(opts);
          return Promise.resolve();
        },
      },
      App: {
        addListener: () => ({ remove: () => {} }),
        minimizeApp: () => {},
      },
      StatusBar: {
        setBackgroundColor: () => Promise.resolve(),
        setStyle: () => Promise.resolve(),
      },
      // Set window.__pendingSharedFile = { name, text } before navigating
      // to simulate MainActivity having received a file via ACTION_VIEW/
      // ACTION_SEND -- consumed (set back to null) the same one-shot way
      // the real native PendingSharedFile.take() is.
      ShareReceiver: {
        takePendingSharedFile: () => {
          const pending = window.__pendingSharedFile || null;
          window.__pendingSharedFile = null;
          return Promise.resolve(pending || { name: null, text: null });
        },
      },
    },
  };
`;

/** A phone-width viewport, matching the app's own @media (max-width: 860px) breakpoint. */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Opens tests/fixtures/demo-workspace/README.md through the "Open .md file" input. */
async function openDemoFile(page) {
  await page.setInputFiles('#file-input', fixturePath('README.md'));
  await page.waitForTimeout(400);
}

/**
 * Fires a single-finger swipe as a real touchscreen would: a pointerdown,
 * two pointermoves toward the target point, and a pointerup, all with
 * pointerType 'touch' so js/ui/gestures.js's mouse-exclusion doesn't ignore
 * it. Dispatched directly (not via Playwright's own mouse-based .click()/
 * .dragTo(), which simulate a real mouse, not touch) since that's what the
 * app's own gesture recognizer listens for.
 */
async function swipe(page, selector, x0, y0, x1, y1, pointerId = 77) {
  await page.evaluate(
    ([sel, sx0, sy0, sx1, sy1, id]) => {
      const el = document.querySelector(sel) || document.body;
      const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
        pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      }));
      fire('pointerdown', sx0, sy0);
      fire('pointermove', (sx0 + sx1) / 2, (sy0 + sy1) / 2);
      fire('pointermove', sx1, sy1);
      fire('pointerup', sx1, sy1);
    },
    [selector, x0, y0, x1, y1, pointerId],
  );
}

/**
 * Routes GitHub's REST/raw-content hosts to fixed, in-memory responses, so
 * GitHub-integration tests are deterministic and don't spend the real
 * unauthenticated rate limit (60 requests/hour/IP) on every test run.
 * `files` is {relPath: content}; the tree and metadata are derived from it.
 */
async function mockGithubRepo(page, { owner, repo, branch = 'main', files }) {
  const tree = Object.keys(files).map((relPath) => ({ path: relPath, type: 'blob', sha: relPath }));
  await page.route(`https://api.github.com/repos/${owner}/${repo}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    // Matches the real shape (verified live against api.github.com) that
    // fetchGithubRepoTree() reads owner/name back from to canonicalize
    // whatever case the user actually typed.
    body: JSON.stringify({ default_branch: branch, name: repo, owner: { login: owner } }),
  }));
  await page.route(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'stub', truncated: false, tree }),
  }));
  await page.route(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/**`, (route) => {
    const url = new URL(route.request().url());
    const relPath = decodeURIComponent(url.pathname.split(`/${owner}/${repo}/${branch}/`)[1]);
    if (Object.prototype.hasOwnProperty.call(files, relPath)) {
      route.fulfill({ status: 200, contentType: 'text/plain', body: files[relPath] });
    } else {
      route.fulfill({ status: 404, body: 'Not Found' });
    }
  });
}

module.exports = {
  FIXTURES_DIR, fixturePath, CAPACITOR_STUB, MOBILE_VIEWPORT, openDemoFile, swipe, mockGithubRepo,
};
