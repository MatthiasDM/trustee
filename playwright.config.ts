import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5199", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "nl-BE", timezoneId: "Europe/Brussels" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec\.ts/ }, { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ }],
  webServer: { command: "node scripts/test-env.mjs reset && npx vite --port 5199 --strictPort --host 127.0.0.1", url: "http://127.0.0.1:5199/api/health", reuseExistingServer: false, timeout: 120000, env: { TRUSTEE_STATE: ".wrangler/test-state", CLOUDFLARE_ENV: "test" } },
});
