import { defineConfig, devices } from "@playwright/test";

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/opt/google/chrome/chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    actionTimeout: 30_000,
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 5"],
        launchOptions: { executablePath: chromiumPath },
      },
    },
    {
      name: "webkit",
      use: { ...devices["iPhone 13"] },
    },
  ],
});