import { defineConfig } from "@playwright/test";

const WEB_API_BASE_URL = "http://127.0.0.1:32001";
const MOBILE_API_BASE_URL = "http://127.0.0.1:32002";
const COLLABORATION_API_BASE_URL = "http://127.0.0.1:32003";
const WEB_APP_BASE_URL = "http://127.0.0.1:32100";
const COLLABORATION_APP_BASE_URL = "http://127.0.0.1:32101";
const MOBILE_APP_BASE_URL = "http://127.0.0.1:32102";

/**
 * Separate Playwright run dedicated to desktop (windowed), mobile-compact
 * (routed), and authenticated two-peer collaboration screenshots. Kept apart
 * from the e2e behavior suite (playwright.config.ts) so screenshotting never
 * blocks or is blocked by the assertion tests.
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
      // Mobile compact layout: width < 760px puts the routed shell in its
      // phone-style "mobile" tier (top app bar + slide-in nav drawer). See
      // packages/app/src/navigation/breakpoints.ts.
      name: "mobile",
      metadata: { screenshotApiBaseUrl: MOBILE_API_BASE_URL },
      testMatch: "**/capture.spec.ts",
      use: {
        baseURL: MOBILE_APP_BASE_URL,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      // Authenticated, dual-pane collaboration scenarios run against the demo
      // host profile on its own app-web server.
      name: "collaboration",
      testMatch: "**/blame.spec.ts",
      use: {
        baseURL: COLLABORATION_APP_BASE_URL,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
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
