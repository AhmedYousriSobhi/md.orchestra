#!/usr/bin/env bash
# Starts the container (if it isn't already serving) and opens the app in
# its own standalone window — no address bar/tabs — rather than a plain
# browser tab. `docker run`/`docker compose up` on their own only start a
# web server; nothing about Docker opens a window, so that's done here.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
URL="http://localhost:${PORT}/index.html"

is_up() { curl -fs -o /dev/null "$URL"; }

if ! is_up; then
  echo "Starting the container (docker compose up -d --build)..."
  docker compose up -d --build
  echo -n "Waiting for it to respond on ${URL}"
  for _ in $(seq 1 30); do
    is_up && { echo; break; }
    echo -n "."
    sleep 1
  done
  if ! is_up; then
    echo
    echo "Still not responding — check 'docker compose logs' (and make sure port ${PORT} isn't used by something else; set PORT=<other> to change it)."
    exit 1
  fi
else
  echo "Already serving at ${URL} — reusing it."
fi

# Chrome/Edge/Chromium's --app= opens a real chromeless window (no address
# bar or tabs) — the closest thing to "running like an app" without
# installing the PWA first. Prefer it when available.
for browser in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$browser" >/dev/null 2>&1; then
    echo "Opening in a standalone app window via $browser..."
    "$browser" --app="$URL" --new-window >/dev/null 2>&1 &
    disown
    exit 0
  fi
done

# Firefox has no equivalent chromeless app-window flag; --new-window still
# gives a genuinely separate OS window (with normal browser chrome), which
# is closer to what's wanted than opening another tab in an existing window.
if command -v firefox >/dev/null 2>&1; then
  echo "Opening in a new Firefox window via --new-window (Firefox has no chromeless app-window mode like Chrome's --app=)..."
  firefox --new-window "$URL" >/dev/null 2>&1 &
  disown
  exit 0
fi

echo "No Chrome/Edge/Chromium/Firefox found for a dedicated window."
echo "Open ${URL} manually, or install the app from the browser's own menu (it's a PWA) for a windowed launch next time."
command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 || true
