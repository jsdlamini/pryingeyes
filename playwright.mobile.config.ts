import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the phone app, run against its web build (mobile/dist-web on :8081)
 * talking to the PryingEyes server on :3000 (with MOBILE_DEV_ORIGINS=http://localhost:8081).
 *   cd mobile && npx expo export --platform web --output-dir dist-web && cd ..
 *   npx playwright test -c playwright.mobile.config.ts
 */
export default defineConfig({
  testDir: "./tests/e2e-mobile",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:8081",
    trace: "retain-on-failure", screenshot: "only-on-failure",
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) },
  },
  webServer: { command: "node tests/e2e-mobile/serve.mjs mobile/dist-web", url: "http://localhost:8081", reuseExistingServer: true, timeout: 30_000 },
});
