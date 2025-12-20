import {defineConfig} from '@playwright/test';

/**
 * Playwright configuration for Electron tests
 * See https://playwright.dev/docs/api/class-electron
 */
export default defineConfig({
  testDir: './tests/electron',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
  },
});
