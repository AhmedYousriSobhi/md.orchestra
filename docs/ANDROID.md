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

## What's genuinely not done yet

Said plainly, so nothing here is silently oversold:

- **No real-device or emulator testing.** This sandbox has neither an
  Android device nor an emulator attached — everything above was verified
  by reading the plugin's actual native source (Java) to get the API
  contract right, and by confirming the app builds into a real, correctly-
  structured APK. Whether the folder picker, file read/write, and the rest
  of the app actually behave correctly when tapped through on a real
  device is **untested** and should be the very next thing checked.
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
  assumed done because one layout bug got fixed.
- **No app icon/splash screen of our own.** The generated Android project
  still uses Capacitor's own default launcher icon and splash image, not
  `icons/icon.svg`.
- **No release signing, Play Store, or F-Droid packaging.** `build-android.sh`
  produces a debug build only, installable for testing
  (`adb install -r dist-android/app-debug.apk`) but not something to
  distribute as-is. See `MORE.md`'s research notes on Android distribution
  for the F-Droid-vs-Google-Play tradeoffs once this is further along.

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
