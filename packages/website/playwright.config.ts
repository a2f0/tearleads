import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for website navigation tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],

  webServer: {
    command: 'pnpm run preview',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
