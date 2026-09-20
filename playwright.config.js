// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Runs the app exactly the way a person would open it in a browser: as
 * static files served over HTTP (the same `npm run web` command this repo
 * already uses), in one Chromium project. There's no Electron/Capacitor
 * native project here, so main-process/native plugin code (electron/main.js,
 * the Android Gradle project) is out of scope by construction — see
 * TESTING.md for what that means is still manual, and tests/helpers.js's
 * CAPACITOR_STUB for how a test gets the app's own Capacitor-only code
 * paths to run at all without a real device.
 *
 * One project, not a "desktop"/"mobile" split: which viewport a test needs
 * is part of what that test is actually checking, so each spec file sets
 * its own via `test.use({ viewport })` (see tests/helpers.js's
 * MOBILE_VIEWPORT) rather than every file silently running twice against
 * both a wide and a narrow default.
 */
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:8899',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run web',
    url: 'http://localhost:8899',
    reuseExistingServer: !process.env.CI,
  },
});
