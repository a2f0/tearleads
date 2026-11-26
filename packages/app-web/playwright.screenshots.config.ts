import { defineConfig, devices } from "@playwright/test";

const WEB_API_BASE_URL = "http://127.0.0.1:32001";
const MOBILE_API_BASE_URL = "http://127.0.0.1:32002";
const WEB_APP_BASE_URL = "http://127.0.0.1:32100";
const MOBILE_APP_BASE_URL = "http://127.0.0.1:32102";

// Phones are captured as the whole screen, like an installed app, rather than
// Playwright's iPhone 13 Safari viewport (390x664), whose missing browser
// chrome made framed captures look too wide. Keeping the profile's UA, touch
// input, and 3x scale gives 1170x2532 images; frames size from each image's
// recorded width and height.
const IPHONE_SCREEN = { width: 390, height: 844 };
const IPHONE = {
  ...devices["iPhone 13"],
  viewport: IPHONE_SCREEN,
  screen: IPHONE_SCREEN,
};

/**
 * Separate Playwright run dedicated to desktop (windowed), iPad and
 * mobile-compact (routed) screenshots. Kept
 * apart from the e2e behavior suite (playwright.config.ts) so screenshotting
 * never blocks or is blocked by the assertion tests.
 *
 * Each capture API is seeded by a setup project first (screenshots/
 * seed.setup.ts), which runs the `tearleads` CLI against it. Playwright runs a
 * selected project's dependencies, so `--project=mobile` still seeds its API.
 *
 * Run: bun run screenshots
 */
export default defineConfig({
  // Check capture ownership before tests, not when static tools import config.
  globalSetup: "./screenshots/sharedStore.ts",
  testDir: "./screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Routed captures reload every view in both themes, and each signed-in load
  // re-syncs the seeded account: a routed project took 7.4 minutes on a quiet
  // machine. Individual readiness assertions retain short timeouts.
  timeout: 900_000,
  reporter: [["list"]],
  use: {
    baseURL: WEB_APP_BASE_URL,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    {
      name: "seed-web",
      metadata: { screenshotApiBaseUrl: WEB_API_BASE_URL },
      testMatch: "**/seed.setup.ts",
    },
    {
      // iPad and mobile share one API, seeded once.
      name: "seed-mobile",
      metadata: { screenshotApiBaseUrl: MOBILE_API_BASE_URL },
      testMatch: "**/seed.setup.ts",
    },
    {
      // Desktop / windowed capture; the screenshot helper selects windowed mode.
      name: "web",
      dependencies: ["seed-web"],
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
      dependencies: ["seed-mobile"],
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
      dependencies: ["seed-mobile"],
      metadata: { screenshotApiBaseUrl: MOBILE_API_BASE_URL },
      testMatch: "**/capture.spec.ts",
      use: {
        ...IPHONE,
        baseURL: MOBILE_APP_BASE_URL,
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command:
        "API_PORT=32001 API_DATABASE=memory BLOB_OBJECT_STORE=memory bun ../api/src/index.ts",
      url: WEB_API_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command:
        "API_PORT=32002 API_DATABASE=memory BLOB_OBJECT_STORE=memory bun ../api/src/index.ts",
      url: MOBILE_API_BASE_URL,
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
        "APP_WEB_PORT=32102 BUN_PUBLIC_API_BASE_URL=http://127.0.0.1:32002 BUN_PUBLIC_APP_VARIANT=screenshot bun src/servers/e2eServer.ts",
      url: MOBILE_APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  ],
});
