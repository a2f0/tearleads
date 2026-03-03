import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Playwright configuration for capturing app screenshots at mobile and desktop viewports.
 * Run: pnpm screenshots
 */
export default defineConfig({
  testDir: './tests/screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  reporter: [['list']],
  timeout: 30000,
  use: {
    baseURL,
  },

  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        deviceScaleFactor: 2.6,
        viewport: { width: 412, height: 732 },
      },
    },
    {
      name: 'browser',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: {
    command: (() => {
      const port = new URL(baseURL).port;
      const portFlag = port && port !== '3000' ? ` --port ${port}` : '';
      return `./node_modules/.bin/vite${portFlag}`;
    })(),
    env: {
      ...process.env,
      VITE_API_URL: 'http://localhost:5001/v1',
    },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
