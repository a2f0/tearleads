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
const getHandleLabel = (item: unknown): string => {
  if (item && typeof item === 'object') {
    const ctor = (item as { constructor?: { name?: string } }).constructor;
    if (ctor?.name) {
      return ctor.name;
    }
  }
  return Object.prototype.toString.call(item);
};

const summarizeObjects = (items: unknown[]): string[] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getHandleLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} x${count}`);
};

const formatHandle = (handle: unknown): string => {
  if (!handle || typeof handle !== 'object') {
    return String(handle);
  }

  const record = handle as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  if (typeof record['timeout'] === 'number') {
    summary['timeout'] = record['timeout'];
  }
  if (typeof record['_idleTimeout'] === 'number') {
    summary['idleTimeout'] = record['_idleTimeout'];
  }
  if (typeof record['_idleStart'] === 'number') {
    summary['idleStart'] = record['_idleStart'];
  }
  if (typeof record['localPort'] === 'number') {
    summary['localPort'] = record['localPort'];
  }
  if (typeof record['remotePort'] === 'number') {
    summary['remotePort'] = record['remotePort'];
  }
  if (typeof record['remoteAddress'] === 'string') {
    summary['remoteAddress'] = record['remoteAddress'];
  }
  if (typeof record['listening'] === 'boolean') {
    summary['listening'] = record['listening'];
  }
  if (typeof record['readable'] === 'boolean') {
    summary['readable'] = record['readable'];
  }
  if (typeof record['writable'] === 'boolean') {
    summary['writable'] = record['writable'];
  }
  if (typeof record['pid'] === 'number') {
    summary['pid'] = record['pid'];
  }
  if (typeof record['spawnfile'] === 'string') {
    summary['spawnfile'] = record['spawnfile'];
  }
  if (Array.isArray(record['spawnargs'])) {
    summary['spawnargs'] = (record['spawnargs'] as string[]).slice(0, 3);
  }

  return `${getHandleLabel(handle)} ${JSON.stringify(summary)}`;
};

export const test = base.extend({
  /**
   * Auto-running worker fixture that unrefs handles after all tests complete.
   * This allows the worker process to exit even if handles are still open.
   * We only unref (not destroy) to avoid breaking Playwright IPC channels.
   */
  _workerCleanup: [
    async ({}, use, workerInfo) => {
      await use();
      const handles = process._getActiveHandles?.() ?? [];

      // Debug logging if enabled
      if (process.env['PW_DUMP_WORKER_HANDLES'] === 'true') {
        const requests = process._getActiveRequests?.() ?? [];
        console.log(`[worker ${workerInfo.workerIndex}] cleanup - handles:`, handles.length);
        if (handles.length > 0) {
          console.log(
            `[worker ${workerInfo.workerIndex}] handle summary:`,
            summarizeObjects(handles).join(', ')
          );
          handles.slice(0, 10).forEach((h, i) => {
            console.log(`[worker ${workerInfo.workerIndex}] handle ${i + 1}:`, formatHandle(h));
          });
        }
        if (requests.length > 0) {
          console.log(`[worker ${workerInfo.workerIndex}] requests:`, requests.length);
        }
      }

      // Unref all handles to allow process to exit (don't destroy - breaks IPC)
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
    { scope: 'worker', auto: true }
  ],
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
