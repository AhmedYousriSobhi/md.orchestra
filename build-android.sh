#!/usr/bin/env bash
# Builds the MD.Orchestra Android app into a debug APK using Docker — no
# Android Studio, SDK, or Gradle needed on this machine, just Docker
# itself. The result lands in ./dist-android/ on the host. This is a debug
# build for installing on a device/emulator to try it (adb install, or
# copy it over and tap to install with "unknown sources" allowed) — not a
# signed release build for the Play Store or F-Droid.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building the Android app image (this pulls a JDK + downloads the Android SDK the first time — expect it to take a while)..."
docker build -f Dockerfile.android --target artifacts --output dist-android .

APK=$(find dist-android -maxdepth 1 -name '*.apk' | head -1)
if [ -z "$APK" ]; then
  echo "Build finished, but no .apk was found in dist-android/ — check the build output above." >&2
  exit 1
fi

echo
echo "Done: $APK"
echo "Install it on a connected device/emulator with:"
echo "  adb install -r $APK"
