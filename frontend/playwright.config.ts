import { defineConfig } from "@playwright/test";

// Serves the production build (with data copied into dist/data) and drives it in Chromium.
const base = process.env.ATLAS_BASE_PATH || "/";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // PW_CHANNEL=chrome runs against an installed Google Chrome instead of the downloaded Chromium.
  use: { baseURL: `http://localhost:4173${base}`, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  webServer: { command: "npm run preview -- --port 4173 --strictPort", url: `http://localhost:4173${base}`, reuseExistingServer: !process.env.CI },
});
