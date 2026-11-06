import { defineConfig } from "@playwright/test";

/**
 * Captures the screenshots used in the documentation (docs/latex/screens/*.png).
 * Needs the website on :3000 and the phone app's web build on :8081, like the end-to-end tests:
 *   cd mobile && npx expo export --platform web --output-dir dist-web && cd ..
 *   npx playwright test -c playwright.screens.config.ts
 */
export default defineConfig({
  testDir: "./tests/screens",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--hide-scrollbars"],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) },
  },
  webServer: { command: "node tests/e2e-mobile/serve.mjs mobile/dist-web", url: "http://localhost:8081", reuseExistingServer: true, timeout: 30_000 },
});
