#!/usr/bin/env bash
# Builds the MD.Orchestra desktop app into a Linux AppImage using Docker —
# no Node/Electron toolchain needed on this machine, just Docker itself.
# The result lands in ./dist/ on the host; nothing here runs the app or
# needs a display, since packaging (unlike launching) doesn't need one.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building the desktop app image..."
docker build -f Dockerfile.electron --target artifacts --output dist .

APPIMAGE=$(find dist -maxdepth 1 -name '*.AppImage' | head -1)
if [ -z "$APPIMAGE" ]; then
  echo "Build finished, but no .AppImage was found in dist/ — check the build output above." >&2
  exit 1
fi

chmod +x "$APPIMAGE"
echo
echo "Done: $APPIMAGE"
echo "Run it directly — no install needed:"
echo "  $APPIMAGE"
