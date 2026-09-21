#!/usr/bin/env bash
# Runs the Playwright test suite (tests/*.spec.js) in Docker -- no local
# Node or browser install needed, the same idea as build-android.sh and
# build-desktop.sh. Chromium itself is expected to already be present
# under ~/.cache/ms-playwright (bind-mounted in below); if it isn't yet,
# install it once with:
#   npx playwright install chromium
# (needs Node locally for that one-time step, or run it inside this same
# image: `docker run --rm -v ~/.cache/ms-playwright:/root/.cache/ms-playwright node:20-bookworm npx -y playwright@1.63.0 install chromium`)
set -euo pipefail
cd "$(dirname "$0")"

PLAYWRIGHT_CACHE="${HOME}/.cache/ms-playwright"
if [ ! -d "$PLAYWRIGHT_CACHE" ]; then
  echo "No cached Playwright browser found at $PLAYWRIGHT_CACHE." >&2
  echo "Install it once with: npx playwright install chromium" >&2
  exit 1
fi

echo "Running the Playwright test suite..."
docker run --rm \
  -v "$(pwd)":/app \
  -v "$PLAYWRIGHT_CACHE":/root/.cache/ms-playwright \
  -w /app \
  -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
  node:20-bookworm \
  bash -c '
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq python3 \
      libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
      libatspi2.0-0 libx11-6 libxcb1 libxext6 fonts-liberation >/dev/null 2>&1
    npm ci >/dev/null 2>&1
    npx playwright test "$@"
  ' -- "$@"
