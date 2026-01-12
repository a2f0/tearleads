import {defineConfig} from '@playwright/test';

/**
 * Playwright configuration for Electron tests
 * See https://playwright.dev/docs/api/class-electron
 */
export default defineConfig({
  testDir: './tests/electron',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  maxFailures: 1, // Bail on first failure
  reporter: [['html', { open: 'never' }]],
  timeout: 60000,
});
