# Android — status and how to build it

The beginning of an Android port, using [Capacitor](https://capacitorjs.com/)
to wrap the exact same HTML/CSS/JS this app already is, rather than a
rewrite. This document is an honest account of what's actually been built
and verified so far, and what's still genuinely missing — not a claim that
the Android app is finished.

## What's real right now

- A working Capacitor Android project (`android/`), committed to the repo
  (Capacitor's own convention — it can carry real native changes, not just
  regenerable boilerplate).
- A filesystem adapter (`js/core/capacitorFsAdapter.js`) implementing the
  same handle shape `js/core/electronFsAdapter.js` and the browser File
  System Access API both already do, so `workspaceIO.js`'s existing
  directory-walking/create/delete logic works completely unchanged against
  it. Backed by
  [`@daniele-rolli/capacitor-scoped-storage`](https://github.com/Daniele-rolli/capacitor-scoped-storage),
  a free, open-source plugin wrapping Android's Storage Access Framework —
  pick a folder once, keep read/write access to it across app restarts,
  the same "only what you've explicitly opened" model the Electron
  allowlist and the browser API both already enforce their own way.
- `./build-android.sh` (Docker only, no Android Studio/SDK/Gradle needed on
  the host — same idea as `build-desktop.sh`) actually produces a real,
  installable debug APK. **Verified, not assumed**: the build was run for
  real, failed twice on real Gradle/Kotlin toolchain issues (see below),
  got fixed both times, and the resulting `dist-android/app-debug.apk` was
  confirmed to be a genuine signed APK containing this project's actual
  `index.html`/`js/main.js`, not just a "the build script exists" claim.
- A phone-width layout bug caught and fixed along the way: the Preview
  panel's own peek-tab (`.edge-toggle`) used a desktop-only positioning
  formula that, at phone width (where Preview is already full-screen —
  see `css/layout.css`'s existing `@media (max-width: 860px)` block),
  placed the tab floating in the middle of the screen over whatever
  content was under it. Now hidden at that width when Preview is already
  open, since its own ✕ already closes it.
- **A real device test round** (see "First real-device test" below) that
  drove a genuine security/battery/polish hardening pass: the hardware
  back button now actually does something sensible, the status bar and
  app icon/splash match the real brand instead of Capacitor's defaults,
  the API key can no longer end up in Android's cloud backup, and any
  uncaught JS error now shows as a real toast instead of a silently dead
  button — directly because a silently dead button is exactly what the
  first test round ran into.
- **The ☰ sidebar toggle bug from that first test round is fixed.** Root
  cause, found via in-app diagnostics after static code reading turned up
  nothing: the preview panel was never explicitly hidden when no document
  was loaded (only ever hidden by the user's own open/closed preference,
  or by closing it directly). At phone width, an unhidden preview panel is
  `position: absolute; inset: 0` with an opaque background and a higher
  z-index (16) than the mobile sidebar drawer (15) — so on first launch,
  with the "preview open" preference defaulting to true and no document
  loaded yet, the preview panel sat as a full-viewport, opaque layer on
  top of the sidebar's own space. The sidebar's toggle and CSS transform
  were working correctly the whole time (confirmed via diagnostic
  toasts showing `open=true` with the correct on-screen rect) — it was
  just rendering underneath that layer. Fixed in `js/main.js`'s `render()`
  by forcing the preview panel hidden whenever there's no document, and
  restoring it to the user's real stored preference the moment a document
  actually loads. Verified with a Playwright simulation: the sidebar's
  rect now moves fully on-screen with the preview panel's rect correctly
  collapsed to 0×0, and separately confirmed opening a document still
  un-hides the preview panel per the stored preference as before.
  **Confirmed fixed on the real device** by the second real-device test
  round.
- **Second real-device test round found and fixed four more things:**
  1. The sidebar drawer never closed itself on a phone — tapping into the
     document behind it (to actually read or edit something) left it
     sitting open until the ☰ button was pressed again. Fixed: any tap
     outside the drawer (and outside the ☰ button itself) now closes it,
     matching how a standard mobile nav drawer behaves.
  2. The mind map's default zoom was wrong on the real device — a small
     graph rendered as a tiny cluster low in a mostly-blank canvas, and
     the Fit button didn't correct it either. Root cause: the SVG's
     `viewBox` and the "fit" math were both computed once, from the
     container's size at the moment it first mounted — on that WebView,
     an early read of `container.clientWidth`/`clientHeight` came out
     wrong (0, or some other stale pre-layout value), and nothing ever
     re-measured after that, so every later Fit press just re-centered
     within the same wrong, frozen dimensions. Fixed in
     `js/ui/mindMap.js`: the container is now re-measured fresh on every
     fit (mount and every Fit press), and a `ResizeObserver` catches the
     case even if that very first measurement was still wrong, silently
     re-fitting the instant the container reports its real size — but
     only until the user has actually touched the map themselves, so it
     never yanks a deliberate pan/zoom back to auto-fit later.
  3. No pinch-to-zoom on the mind map — it only ever supported a mouse
     wheel for zooming, which doesn't exist on a touchscreen. Added real
     two-finger pinch support (tracking both active pointers, anchored on
     their midpoint the same way wheel-zoom anchors on the cursor), with
     a clean handoff back to one-finger panning when a pinch ends with one
     finger still down.
  4. Two things reported alongside the above turned out not to be bugs,
     worth recording so they aren't re-investigated as one later: the
     system folder picker only showing Downloads/Google Drive by default
     is Android's own picker UI, not this app's — the picker is invoked
     with a plain, unrestricted `ACTION_OPEN_DOCUMENT_TREE` intent (no
     provider hint at all, confirmed by reading the plugin's own Java
     source), so every provider on the device is genuinely available,
     just possibly behind that picker screen's own hamburger/menu icon
     for "Internal storage" or "This device" rather than shown by
     default. And no storage/photos permission prompt appears because
     none is needed: the whole point of using Android's Storage Access
     Framework here (see "What's real right now" above) is that folder
     access is scoped and OS-granted per folder the user explicitly
     picks, deliberately avoiding the broad storage/media runtime
     permission a traditional file-access approach would require.
- **Third real-device test round: the sidebar went dead again, this time
  whenever the preview panel was actually open** — pressing ☰ while
  previewing a file (or right after creating a new file, which opens
  straight into preview since that's the default) did nothing visible,
  the same symptom as the original Stage 80 bug but a different trigger.
  Root cause: `css/layout.css`'s mobile breakpoint gives the sidebar and
  preview panel fixed z-indexes (15 and 16) regardless of which one the
  user just opened, so the preview panel — legitimately shown, not the
  Stage 80 no-document case — sat above the sidebar exactly the same way.
  The ☰ button and its class-toggle worked correctly every time; the
  drawer was just rendering invisibly underneath. Fixed with one CSS
  rule: `aside#sidebar.sidebar-open` now gets `z-index: 17` at this
  breakpoint, so the sidebar is always the topmost layer whenever it's
  actually open, independent of whatever the preview panel is doing.
  Verified with Playwright: with a document loaded and preview open by
  default, toggling the sidebar now makes it the real
  `document.elementFromPoint()` hit target, not just a class that's
  present in the DOM.
- **The Keyboard Shortcuts panel is replaced with a Touch Gestures guide
  on Capacitor** (Stage 83), and real navigation gestures back it up —
  not just a relabeled button. Every action in `shortcutsPanel.js`'s
  table already has its own tappable toolbar button, so there was nothing
  to gesture-ify there; what was actually missing was touch-native
  *navigation*. Added: edge-swipe from the left goes back to the parent
  section (mirroring iOS's own back-swipe convention), or opens the
  sidebar drawer if there's nowhere to go back to; swiping the open
  drawer itself to the left closes it, alongside the existing
  tap-outside-to-close; and the mind map's existing pinch-to-zoom is
  listed too. `js/ui/gestures.js` has the shared swipe-recognition logic
  (touch-only — a real mouse already has every affordance these exist
  for as a click), `js/ui/gesturesPanel.js` is the new guide panel, and
  `settingsPanel.js` swaps between it and the keyboard-shortcuts guide
  based on `isCapacitor`. Verified with Playwright across three real
  navigation depths (a nested heading going up one level to its actual
  parent, not skipping to the document root; a shallower heading doing
  the same one level up; and the shallowest heading reaching the true
  document root) plus both sidebar-drawer gestures — all fired in the
  browser's DOM exactly as designed, not just class names asserted.

## What's genuinely not done yet

Said plainly, so nothing here is silently oversold:

- **Still only one round of real-device testing.** It surfaced one bug,
  now root-caused and fixed (see "First real-device test" below) but not
  yet re-confirmed on an actual phone — only via a Playwright simulation
  so far. Whether the folder picker, file read/write, and the rest of the
  app behave correctly when tapped through for real is otherwise still
  mostly unverified beyond that one round.
- **No single-file "Open .md file" on Android.** The scoped-storage plugin
  only offers a folder-tree picker (`ACTION_OPEN_DOCUMENT_TREE`) — there's
  no SAF single-document equivalent wired up. The generic `<input
  type="file">` fallback this app already uses for browsers without the
  File System Access API works for *reading* a single file inside a
  Capacitor WebView, but saving it back relies on a Blob-URL download,
  whose behavior inside a Capacitor WebView (vs. a real browser tab) is
  untested here — a real gap, not a hypothetical one.
- **No mobile-specific UI redesign.** The existing `@media (max-width:
  860px)` rules (sidebar becomes a slide-in drawer, preview goes
  full-screen) happen to hold up reasonably well at phone width — good
  enough to *begin* on — but nothing here was purpose-built for a phone
  screen, and a proper pass deserves its own scoped look rather than being
  assumed done because a couple of layout bugs got fixed.
- **Basic touch gestures are in** (see "Stage 83" below) — edge-swipe
  back/open-sidebar, swipe-to-close the drawer, tap-outside-to-close, and
  mind-map pinch-to-zoom. Not yet in: long-press context menus, or any
  gesture equivalent for actions that don't already have their own
  toolbar button (add note, add section, etc. — those don't need one,
  since they're already one tap away).
- **No release signing, Play Store, or F-Droid packaging.** `build-android.sh`
  produces a debug build only, installable for testing
  (`adb install -r dist-android/app-debug.apk`) but not something to
  distribute as-is. See `MORE.md`'s research notes on Android distribution
  for the F-Droid-vs-Google-Play tradeoffs once this is further along.
- **ProGuard/R8 minification stays off** (`minifyEnabled false` in
  `android/app/build.gradle`, Capacitor's own default) deliberately —
  turning it on for a real release build needs correct `keep` rules for
  every plugin's reflection-based loading, and getting that wrong silently
  breaks the app in a way this sandbox has no way to catch without a real
  device to test the result on. Left alone until it can actually be
  verified, not flipped on and hoped for.

## Save-to-disk: a real truncation bug found by audit, not by report

Asked to confirm there wasn't a save-to-local-storage issue, an audit of
the actual write path (`js/core/capacitorFsAdapter.js`'s `createWritable()`
down into the plugin's own Java) turned up a genuine one, not previously
hit in testing: `CapacitorScopedStorage.java`'s `writeFile` opened the
target file with Android's `openOutputStream(uri, "w")`. Android's own API
contract does **not** guarantee that `"w"` truncates an existing file on
every SAF provider — some (older Android versions, and some third-party
providers, including Google Drive's own SAF implementation) have shipped
versions that don't reliably truncate on `"w"`, which would leave stale
trailing bytes from the file's previous, longer contents behind whenever a
save made the file *shorter* than before (e.g. deleting a large section).
`"wt"` is the one mode Android documents as guaranteed to truncate on
every provider, so that's the fix.

Since this lives in a vendored third-party plugin under `node_modules/`
(not this app's own code), the fix is committed as a
[`patch-package`](https://github.com/ds300/patch-package) patch
(`patches/@daniele-rolli+capacitor-scoped-storage+0.1.0.patch`) plus a
`postinstall` script in `package.json`, rather than hand-edited and lost
on the next install. Verified for real, not just written and assumed:
removed `node_modules` entirely and ran a completely fresh `npm ci` (the
exact command `Dockerfile.android` runs) — the patch reapplied
automatically, and the resulting Java source read `"wt"`, confirmed by
reading the file back afterward.

## First real-device test

The first APK ever built here was installed on a real phone. Two things
came back:

1. **The Preview peek-tab looked broken** — already explained above: the
   APK sent for that test was built 21 seconds *before* the CSS fix for
   exactly that bug landed. Not a new bug, a stale build on my part; the
   next build included the fix.
2. **Several header buttons appeared unresponsive** — Map and Source are
   *correctly* inert with no document loaded (both are `disabled` until
   one is), but the ☰ sidebar toggle reportedly did nothing either, and
   that one had no such explanation. It's the one way to reach the
   folder-open button on this build (the sidebar holds the whole file
   toolbar, and is off-screen by default at phone width), so it mattered a
   lot. Reading the code alone (the click handler, z-index/stacking around
   the header, anything that could swallow the tap) found nothing
   definitively wrong, so a global uncaught-error toast went in first
   (confirmed no JS error was being thrown), then a second, more targeted
   diagnostic toast on the toggle handler itself confirmed the click *was*
   reaching the handler and the class *was* toggling — the sidebar was
   correctly being told to open. A third round of that same diagnostic,
   this time reporting both elements' actual `getBoundingClientRect()`
   and computed `transform`, found the real cause: the sidebar's own
   transform was landing exactly right, but the preview panel — never
   explicitly hidden when no document is loaded — sat as a full-viewport,
   opaque, higher-z-index layer on top of it. Fixed; see "What's real
   right now" above. Not yet re-confirmed on an actual device.

## Building it

```bash
./build-android.sh
adb install -r dist-android/app-debug.apk
```

Or, for iterating without a full Docker/Gradle round-trip each time (still
needs a local Android SDK + `ANDROID_SDK_ROOT` set):

```bash
npm run cap:sync   # rebuilds web-dist/ and copies it into the native project
cd android && ./gradlew assembleDebug
```

## A real Gradle/Kotlin toolchain issue worth remembering

Two real build failures were hit and fixed while getting this working —
both are exactly the kind of thing worth writing down so they aren't
re-diagnosed from scratch later:

1. **`error: invalid source release: 21`** — `capacitor-android`'s own
   Gradle module targets Java 21; the build image originally used JDK 17,
   which can't compile *for* a source level higher than itself. Fixed by
   moving `Dockerfile.android`'s base image to `eclipse-temurin:21-jdk-jammy`.
2. **Duplicate Kotlin stdlib classes** — `capacitor-cordova-android-plugins`
   (the Cordova compatibility bridge Capacitor still ships) pulls in an
   old, pre-1.8 Kotlin stdlib split across separate `kotlin-stdlib-jdk7`/
   `-jdk8` artifacts; since Kotlin 1.8 that same functionality lives
   directly in `kotlin-stdlib` itself, so having both on the classpath at
   once is a genuine duplicate-class conflict. Fixed with the standard,
   documented workaround — excluding those two old artifacts in
   `android/app/build.gradle`'s `configurations.all { exclude ... }`.
