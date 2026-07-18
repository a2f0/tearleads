import { defineConfig, devices } from "@playwright/test";

const WEB_API_BASE_URL = "http://127.0.0.1:32001";
const MOBILE_API_BASE_URL = "http://127.0.0.1:32002";
const COLLABORATION_API_BASE_URL = "http://127.0.0.1:32003";
const WEB_APP_BASE_URL = "http://127.0.0.1:32100";
const COLLABORATION_APP_BASE_URL = "http://127.0.0.1:32101";
const MOBILE_APP_BASE_URL = "http://127.0.0.1:32102";

/**
 * Separate Playwright run dedicated to desktop (windowed), iPad and
 * mobile-compact (routed), plus authenticated two-peer blame screenshots. Kept
 * apart from the e2e behavior suite (playwright.config.ts) so screenshotting
 * never blocks or is blocked by the assertion tests.
 *
 * Run: bun run screenshots
 */
export default defineConfig({
  testDir: "./screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Each spec walks every screen in one context, so allow generous headroom.
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    baseURL: WEB_APP_BASE_URL,
  },
  projects: [
    {
      // Desktop / windowed layout (viewport >= 1024px).
      name: "web",
      metadata: { screenshotApiBaseUrl: WEB_API_BASE_URL },
      testMatch: "**/capture.spec.ts",
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      // A real iPad profile exercises the routed tablet tier (persistent rail)
      // with touch input and its native device scale factor. It can share the
      // screenshot API/host with mobile because projects run serially and each
      // receives an isolated browser context.
      name: "ipad",
      metadata: { screenshotApiBaseUrl: MOBILE_API_BASE_URL },
      testMatch: "**/capture.spec.ts",
      use: {
        ...devices["iPad Pro 11"],
        baseURL: MOBILE_APP_BASE_URL,
        // Keep the iPad viewport, UA, touch input, and scale factor while using
        // the same browser engine as the other deterministic captures. WebKit
        // cannot currently import the seeded local identity key package.
        browserName: "chromium",
      },
    },
    {
      // Mobile compact layout: width < 760px puts the routed shell in its
      // phone-style "mobile" tier (top app bar + slide-in nav drawer). See
      // packages/app/src/navigation/breakpoints.ts.
      name: "mobile",
      metadata: { screenshotApiBaseUrl: MOBILE_API_BASE_URL },
      testMatch: "**/capture.spec.ts",
      use: {
        ...devices["iPhone 13"],
        baseURL: MOBILE_APP_BASE_URL,
        browserName: "chromium",
      },
    },
    {
      // Blame setup still needs the demo host's two authenticated peers, but
      // its artifacts belong to the ordinary Windowed screenshot collection.
      name: "blame-web",
      metadata: { screenshotLayout: "web" },
      testMatch: "**/blame.spec.ts",
      use: {
        baseURL: COLLABORATION_APP_BASE_URL,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "blame-ipad",
      metadata: { screenshotLayout: "ipad" },
      testMatch: "**/blame.spec.ts",
      use: {
        ...devices["iPad Pro 11"],
        baseURL: COLLABORATION_APP_BASE_URL,
        browserName: "chromium",
      },
    },
    {
      name: "blame-mobile",
      metadata: { screenshotLayout: "mobile" },
      testMatch: "**/blame.spec.ts",
      use: {
        ...devices["iPhone 13"],
        baseURL: COLLABORATION_APP_BASE_URL,
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command:
        "API_PORT=32001 API_DATABASE=memory API_REDIS=memory BLOB_OBJECT_STORE=memory bun ../api/src/index.ts",
      url: WEB_API_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "API_PORT=32002 API_DATABASE=memory API_REDIS=memory BLOB_OBJECT_STORE=memory bun ../api/src/index.ts",
      url: MOBILE_API_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "API_PORT=32003 API_DATABASE=memory API_REDIS=memory BLOB_OBJECT_STORE=memory bun ../api/src/index.ts",
      url: COLLABORATION_API_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "APP_WEB_PORT=32100 BUN_PUBLIC_API_BASE_URL=http://127.0.0.1:32001 BUN_PUBLIC_APP_VARIANT=screenshot bun src/servers/e2eServer.ts",
      url: WEB_APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "APP_WEB_PORT=32101 BUN_PUBLIC_API_BASE_URL=http://127.0.0.1:32003 BUN_PUBLIC_APP_VARIANT=demo bun src/servers/e2eServer.ts",
      url: COLLABORATION_APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "APP_WEB_PORT=32102 BUN_PUBLIC_API_BASE_URL=http://127.0.0.1:32002 BUN_PUBLIC_APP_VARIANT=screenshot bun src/servers/e2eServer.ts",
      url: MOBILE_APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  ],
});
