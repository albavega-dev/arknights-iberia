import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/playwright-results.json" }],
    ["html", { outputFolder: "artifacts/playwright-report", open: "never" }],
  ],
  outputDir: "artifacts/playwright",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3103",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    ignoreHTTPSErrors: false,
  },
  // Without PLAYWRIGHT_BASE_URL the tests run against `next start` on the existing production build.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "corepack pnpm start --hostname 127.0.0.1 --port 3103",
        url: "http://127.0.0.1:3103/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { NEXT_TELEMETRY_DISABLED: "1" },
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], browserName: "chromium" } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
