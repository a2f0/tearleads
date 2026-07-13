import { defineConfig } from "@playwright/test";

/**
 * Separate Playwright run dedicated to capturing app screenshots at the desktop
 * (windowed) and mobile-compact (routed) viewports. Kept apart from the e2e
 * behavior suite (playwright.config.ts) so screenshotting never blocks or is
 * blocked by the assertion tests.
 *
 * Run: bun run screenshots
 */
export default defineConfig({
  testDir: "./screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Each spec walks every screen in one context, so allow generous headroom.
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  projects: [
    {
      // Desktop / windowed layout (viewport >= 1024px).
      name: "web",
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
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: "bun src/servers/e2eServer.ts",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
