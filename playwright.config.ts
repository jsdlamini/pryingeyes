import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app (default http://localhost:3000, APP_ENV=development).
 * Start it first (`npm run build && npm start`), or set E2E_START=1 to let Playwright start it.
 * Uses Playwright's Chromium; set PW_CHROME=/path/to/chrome to use a system Chrome instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL, trace: "retain-on-failure", screenshot: "only-on-failure",
    // Fake microphone so in-app calls can be tested without hardware or permission prompts.
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) },
    permissions: ["microphone"],
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_START ? { command: "npm run start", url: baseURL, reuseExistingServer: true, timeout: 120_000 } : undefined,
});
