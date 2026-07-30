import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Playwright's default also claims `*.test.ts`, which would hand it the unit
  // test that covers the e2e helpers themselves. Specs are Playwright's; tests
  // beside them belong to `bun test`.
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun src/servers/e2eServer.ts",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
