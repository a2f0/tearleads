import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const isHTTPS = baseURL.startsWith('https://');
const parsedWorkers = Number(process.env.PW_WORKERS);
const fullyParallel = process.env.PW_FULLY_PARALLEL === 'true';
// Scale workers based on CPU cores (half cores, min 1, max 8)
// Set PW_WORKERS to override (e.g., PW_WORKERS=1 for serial)
// Each worker uses its own database instance via injected global (see tests/fixtures.ts)
const defaultWorkers = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
const workers =
  Number.isFinite(parsedWorkers) && parsedWorkers > 0
    ? parsedWorkers
    : defaultWorkers;

/**
 * Playwright configuration for integration tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/electron/**'],
  // Each worker has isolated OPFS via addInitScript (see tests/fixtures.ts)
  // Set PW_FULLY_PARALLEL=true to also run tests within files in parallel
  fullyParallel,
  workers,
  forbidOnly: isCI,
  retries: 0,
  maxFailures: 1, // Bail on first failure
  // Safety timeout to force exit if workers hang (10 minutes)
  globalTimeout: 10 * 60 * 1000,
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }]],
  // Always run teardown to detect handle leaks
  // Set PW_DEBUG_HANDLES=true for verbose handle info
  globalTeardown: './tests/playwright-global-teardown.ts',
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
