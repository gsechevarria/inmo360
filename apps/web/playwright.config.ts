import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app en modo local (AUTH_MODE=local) y la base AISLADA de desarrollo.
 * Requiere: base reseteada con datos (scripts/local/db-reset.sh + importaciones) y `npm run dev` en marcha,
 * o deja que Playwright arranque el servidor de desarrollo.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000", storageState: "e2e/.auth/owner.json", trace: "retain-on-failure" },
  globalSetup: "./e2e/global-setup.ts",
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npx next dev --port 3000 --hostname 127.0.0.1", url: "http://127.0.0.1:3000/login", reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /movil/ },
    { name: "movil", use: { ...devices["Pixel 7"] }, testMatch: /movil/ },
  ],
});
