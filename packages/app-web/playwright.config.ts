import { defineConfig } from "@playwright/test";
import { DEMO_APP_PORT, DEMO_APP_URL } from "./e2e/demoServer";
import {
  SIGNED_IN_API_PORT,
  SIGNED_IN_API_URL,
  SIGNED_IN_APP_PORT,
  SIGNED_IN_APP_URL,
} from "./e2e/signedInServer";

const { APP_WEB_PORT = "3100" } = process.env;
const baseURL = `http://127.0.0.1:${APP_WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "firefox",
      use: { browserName: "firefox" },
      grep: /@themed-control/,
    },
    { name: "webkit", use: { browserName: "webkit" }, grep: /@themed-control/ },
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "sh ../../scripts/lib/withBuildInfoEnv.sh bun src/servers/e2eServer.ts",
      url: baseURL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    // A real API, kept in memory, for the specs that need a signed-in session
    // (see e2e/signedInServer.ts). Only the second app server below is built
    // against it, so every other spec still runs signed out.
    {
      command: "bun ../api/src/index.ts",
      env: {
        API_DATABASE: "memory",
        API_PORT: SIGNED_IN_API_PORT,
        BLOB_OBJECT_STORE: "memory",
      },
      url: SIGNED_IN_API_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "sh ../../scripts/lib/withBuildInfoEnv.sh bun src/servers/e2eServer.ts",
      env: {
        APP_WEB_PORT: SIGNED_IN_APP_PORT,
        BUN_PUBLIC_API_BASE_URL: SIGNED_IN_API_URL,
      },
      url: SIGNED_IN_APP_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    // The demo host profile (see e2e/demoServer.ts), for the specs that need
    // the page the demo shows before its panes start.
    {
      command:
        "sh ../../scripts/lib/withBuildInfoEnv.sh bun src/servers/e2eServer.ts",
      env: {
        APP_WEB_PORT: DEMO_APP_PORT,
        BUN_PUBLIC_APP_VARIANT: "demo",
      },
      url: DEMO_APP_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
