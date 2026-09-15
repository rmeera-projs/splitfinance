const { defineConfig, devices } = require("@playwright/test");

// These drive the real UI in a real browser against a running stack -
// `docker compose up` locally, or the compose stack CI brings up. Nothing
// here is mocked: real React, real API, real Postgres.
module.exports = defineConfig({
  testDir: "./tests",
  // Each spec signs up its own uniquely-named account, so specs never
  // contend over the same data and can run in parallel.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30000,

  use: {
    // The e2e stack (docker-compose.e2e.yml), not the normal dev stack on
    // 5173 - so a run never depends on, or disturbs, local dev state.
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5174",
    // Artefacts only for failures, so a green run stays quiet.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
