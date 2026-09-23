import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// Same values the app uses: .env.local locally, repository secrets in CI.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  // Empty the test-only RMC before and after the run (never the demo).
  globalSetup: "./tests/e2e/test-rmc.ts",
  globalTeardown: "./tests/e2e/test-rmc.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Cloud dev containers ship Chromium here; CI installs its own.
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Tests use a stand-in for the AI planner: free and the same every run.
    env: { PLANNER_MODE: "mock" },
  },
});
