import { defineConfig } from "@playwright/test";

const { APP_WEB_PORT = "3100" } = process.env;
const baseURL = `http://127.0.0.1:${APP_WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun src/servers/e2eServer.ts",
    url: baseURL,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
