import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for integration tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/electron/**'],
  // Run tests serially to avoid OPFS storage conflicts
  // OPFS is origin-scoped, so parallel tests on same origin conflict
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // In CI, use bundled Chromium. Locally, use system Chrome if available.
        ...(process.env.CI ? {} : { channel: 'chrome' }),
        launchOptions: {
          args: [
            // Ensure SharedArrayBuffer is available for OPFS VFS
            '--enable-features=SharedArrayBuffer',
          ],
        },
      },
    },
  ],

  webServer: {
    command: 'VITE_API_URL=http://localhost:5001/v1 pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
