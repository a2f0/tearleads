/**
 * Custom Playwright fixtures for parallel test isolation.
 *
 * Each worker injects its index via addInitScript before page scripts run.
 * The app reads this global to select a worker-specific database instance,
 * eliminating OPFS race conditions when running tests in parallel.
 */

import { test as base } from '@playwright/test';

/**
 * Global variable name used to pass worker index to the browser.
 * Must match the name used in src/lib/test-instance.ts
 */
const WORKER_INDEX_GLOBAL = '__PLAYWRIGHT_WORKER_INDEX__';

/**
 * Extended test with worker-isolated database instances.
 *
 * Injects the worker index as a global variable before any page script runs,
 * ensuring each worker uses its own database instance.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.addInitScript(
      ({ globalName, index }) => {
        (window as unknown as Record<string, number>)[globalName] = index;
      },
      { globalName: WORKER_INDEX_GLOBAL, index: testInfo.workerIndex }
    );
    await use(page);
  }
});

export { expect } from '@playwright/test';
