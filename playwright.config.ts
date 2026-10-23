import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  use: { baseURL: "http://127.0.0.1:8080" },
  webServer: { command: "node scripts/serve.ts", url: "http://127.0.0.1:8080", reuseExistingServer: false },
});
