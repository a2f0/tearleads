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

// Track last test activity per worker to detect idle workers
let lastTestActivity = Date.now();

// Enable verbose worker logging with PW_DEBUG_WORKERS=true
const debugWorkers = process.env['PW_DEBUG_WORKERS'] === 'true';

export const test = base.extend({
  /**
   * Auto-running worker fixture that cleans up handles after all tests complete.
   * This allows the worker process to exit even if handles are still open.
   *
   * IMPORTANT: Includes an idle timeout that forces cleanup if Playwright's main
   * process doesn't signal the worker to clean up within 30s of the last test.
   * This works around a Playwright bug where some workers don't receive the cleanup signal.
   */
  _workerCleanup: [
    async ({}, use, workerInfo) => {
      const workerStart = Date.now();
      const workerIdx = workerInfo.workerIndex;

      if (debugWorkers) {
        console.log(`[worker ${workerIdx}] started (pid: ${process.pid})`);
      }

      let cleanupStarted = false;

      // Idle timeout: if no test activity for 30s, assume tests are done and force cleanup
      const idleCheckInterval = setInterval(() => {
        const idleTime = Date.now() - lastTestActivity;
        if (idleTime > 30000 && !cleanupStarted) {
          console.log(
            `[worker ${workerIdx}] idle timeout after ${(idleTime / 1000).toFixed(0)}s, forcing cleanup`
          );
          cleanupStarted = true;
          clearInterval(idleCheckInterval);
          // Unref all handles to allow process to exit
          const handles = process._getActiveHandles?.() ?? [];
          for (const handle of handles) {
            if (!handle || typeof handle !== 'object') continue;
            const h = handle as Record<string, unknown>;
            try {
              if (typeof h['unref'] === 'function') {
                (h['unref'] as () => void)();
              }
            } catch {
              // Ignore errors
            }
          }
        }
      }, 5000);
      idleCheckInterval.unref(); // Don't block exit

      await use();

      cleanupStarted = true;
      clearInterval(idleCheckInterval);

      if (debugWorkers) {
        const elapsed = ((Date.now() - workerStart) / 1000).toFixed(1);
        console.log(`[worker ${workerIdx}] finished in ${elapsed}s, cleaning up`);
      }

      // Unref all handles to allow process to exit
      const handles = process._getActiveHandles?.() ?? [];
      for (const handle of handles) {
        if (!handle || typeof handle !== 'object') continue;
        const h = handle as Record<string, unknown>;
        try {
          if (typeof h['unref'] === 'function') {
            (h['unref'] as () => void)();
          }
        } catch {
          // Ignore errors
        }
      }
    },
    { scope: 'worker', auto: true },
  ],
  page: async ({ page }, use, testInfo) => {
    // Record test activity for idle detection
    lastTestActivity = Date.now();

    await page.addInitScript(
      ({ globalName, index }) => {
        (window as unknown as Record<string, number>)[globalName] = index;
      },
      { globalName: WORKER_INDEX_GLOBAL, index: testInfo.workerIndex }
    );

    await use(page);

    // Record test completion
    lastTestActivity = Date.now();
  },
});

export { expect } from '@playwright/test';
