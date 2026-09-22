# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MD.Orchestra — a Markdown workspace dashboard, ships as an Electron desktop app (primary target) and an Android app (via Capacitor), both local-first with no backend. See [README.md](README.md) for the product pitch, [SPEC.md](SPEC.md) for the functional spec, and [MORE.md](MORE.md) for the full doc index ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ANDROID.md](docs/ANDROID.md), [docs/RELIABILITY_ARCHITECTURE_REVIEW.md](docs/RELIABILITY_ARCHITECTURE_REVIEW.md), [docs/UI_UX_REVIEW.md](docs/UI_UX_REVIEW.md), [TESTING.md](TESTING.md), [CHANGELOG.md](CHANGELOG.md)).

## Repo-specific workflow rules (read before touching anything)

These override default behavior in this repo:

- **Open a GitHub issue and get the user's explicit approval before implementing any bug fix or feature request.** Diagnose first (empirically reproduce, don't just theorize from a description/screenshot), open the issue with the root cause and proposed fix direction(s), wait for the user to pick a direction, only then implement. Reference the issue in the PR body (`Resolves #N`).
- **Branch-per-change.** Never commit straight to `master`. One branch per issue/change.
- **No `Co-Authored-By: Claude...` trailer** in commit messages, and no "Generated with Claude Code" footer in PR descriptions — this repo's owner has explicitly opted out of both, overriding the tool's own default attribution guidance.
- **Don't report a bug as "fixed" until the fix is merged to `master` AND the user has actually relaunched/rebuilt the specific instance they test on.** A merge alone doesn't fix what they're looking at — Electron needs a full quit+relaunch (it loads `index.html` straight off disk via `loadFile`, no bundling step, so no rebuild is needed, but a running process keeps its old in-memory session), the Android APK needs `npm run cap:sync` + a Gradle `assembleDebug` rebuild, and the browser dev server just needs a reload.
- **Confirm before any action that risks crashing/rebooting the user's real machine** (e.g. GPU-accelerated Android emulators), not just after the fact.

## Commands

```bash
npm start                 # run the Electron desktop app (electron .)
npm run web                # dev-only static server on :8899 (no native FS access, no persisted folder across reload — not an equivalent deployment, see docs/ARCHITECTURE.md)
npm test                   # run the full Playwright suite (auto-starts the web server per playwright.config.js)
npx playwright test tests/<file>.spec.js            # run a single spec file
npx playwright test tests/<file>.spec.js -g "name"  # run a single test by name
npm run test:headed        # same, with a visible browser
npm run test:ui            # Playwright's interactive UI runner
npm run build               # package the desktop app (electron-builder, Linux AppImage) — normally invoked via ./build-desktop.sh (Docker-based, see README)
npm run cap:sync            # rebuild web assets into web-dist/ and sync them into the Android Capacitor project — required before any Android Gradle build picks up a JS change
```

`./build-android.sh` builds the debug APK via Docker; see [docs/ANDROID.md](docs/ANDROID.md).

`test-results/` can end up root-owned from an earlier root-run build step in this environment, which breaks `npx playwright test` with `EACCES`. If that happens, don't `sudo rm -rf` it — pass `--output=/tmp/pw-test-results` (or similar) to redirect Playwright's output directory instead.

There's no separate lint script; the codebase has no bundler/TypeScript build step to run either — `js/` is plain ES modules loaded directly by `index.html`.

## Architecture

No bundler — every file under `js/` is a plain ES module, openable and debuggable on its own. Full file-by-file layout is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the parts that span multiple files and are easy to get wrong:

- **Filesystem is adapter-pattern, not platform-branched throughout.** `js/core/fileIO.js` / `js/core/workspaceIO.js` are written once against the browser's `FileSystemFileHandle`/`FileSystemDirectoryHandle` shape (`.getFile()`, `.createWritable()`, `.entries()`, `.getFileHandle(name, {create})`, `.removeEntry(name)`). `js/core/electronFsAdapter.js` constructs plain objects with that exact same shape, backed by IPC to `electron/main.js`'s real `fs` calls (exposed to the renderer as `window.electronFS` via `electron/preload.js`, with `contextIsolation: true` and an in-main-process path allowlist — the renderer never gets raw Node access). Capacitor/Android goes through its own native `ScopedStorage` plugin instead (see `tests/helpers.js`'s `CAPACITOR_STUB` for the exact plugin surface the app calls). When adding filesystem behavior, implement it once against the handle shape rather than branching on platform in call sites.
- **Two independent sources of "is this file open," and bugs live in the gap between them.** `js/state/store.js` holds the single active document (in-memory, session-only) and `openStandaloneFileNames`-style session sets track what's open *this session*. Separately, `js/core/recovery.js` persists per-file crash-recovery snapshots to `localStorage` (`mdDashboard.recovery.v2`), independent of session state and surviving reloads/relaunches. A restored snapshot's `workspaceRelPath`/`workspaceRootName` are not currently validated against which workspaces are actually open this session — several real bugs have come from a restored file falling into a state that's neither a recognized "standalone file" nor a recognized "workspace file" to the Explorer UI. Any change touching recovery/restore or the Explorer's "open files" rendering should account for this gap explicitly.
- **Document data model:** each Markdown heading becomes a node `{ id, level, title, bodyMarkdown, children[] }` (`js/markdown/parser.js` builds it, `js/markdown/serializer.js` reverses it). `bodyMarkdown` is kept verbatim so re-serializing an untouched document round-trips byte-faithfully; notes/AI insertions live inside `bodyMarkdown` between marker comments so they rehydrate into the right UI slot on reload instead of duplicating.
- **AI calls go straight from the renderer to `https://api.anthropic.com/v1/messages`** — no backend/proxy (`js/ai/client.js`). Only Claude is supported.
- **Testing is single-project, browser-only by construction.** `playwright.config.js` runs everything against `npm run web` in one Chromium project — there's no Electron/Capacitor native test harness, so `electron/main.js` and the Android Gradle project are exercised manually, not by the Playwright suite (see [TESTING.md](TESTING.md) for what that leaves manual). Viewport is set per-spec via `test.use({ viewport })`, not via separate desktop/mobile projects.
- **CHANGELOG.md is a running staged log** ("Stage N" entries), not a curated release changelog — check it for the most recent context on what changed and why before assuming a piece of behavior is undocumented.
