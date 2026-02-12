import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const isHTTPS = baseURL.startsWith('https://');

/**
 * Playwright configuration for website navigation tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Accept self-signed certificates in CI when using HTTPS
    ignoreHTTPSErrors: isHTTPS,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(isCI ? {} : { channel: 'chrome' }),
        launchOptions: {
          args: isHTTPS ? ['--ignore-certificate-errors'] : [],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: isHTTPS
            ? {
                // Disable strict transport security for self-signed certs
                'security.cert_pinning.enforcement_level': 0,
                'network.stricttransportsecurity.preloadlist': false,
              }
            : {},
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // In CI with HTTPS, NGINX serves the built site (no webServer needed)
  // In development or CI with HTTP, use Astro preview server
  ...(isCI && isHTTPS
    ? {}
    : {
        webServer: {
          command: 'pnpm run preview',
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 30000,
        },
      }),
});
