import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const isHTTPS = baseURL.startsWith('https://');

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
  forbidOnly: isCI,
  retries: 0,
  maxFailures: 1, // Bail on first failure
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL,
    // Accept self-signed certificates in CI when using HTTPS
    ignoreHTTPSErrors: isHTTPS,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // In CI, use bundled Chromium. Locally, use system Chrome if available.
        ...(isCI ? {} : { channel: 'chrome' }),
        launchOptions: {
          args: [
            // Ensure SharedArrayBuffer is available for OPFS VFS
            '--enable-features=SharedArrayBuffer',
            // Accept self-signed certificates when using HTTPS
            ...(isHTTPS ? ['--ignore-certificate-errors'] : []),
          ],
        },
      },
    },
  ],

  // In CI with HTTPS, NGINX serves the built app (no webServer needed)
  // In development or CI with HTTP, use Vite dev server
  ...(isCI && isHTTPS
    ? {}
    : {
        webServer: {
          command: 'VITE_API_URL=http://localhost:5001/v1 pnpm run dev',
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 120000,
        },
      }),
});
