/**
 * Custom Playwright fixtures for parallel test isolation.
 *
 * Each worker gets a unique testWorker query param appended to URLs,
 * which the app uses to select a worker-specific database instance.
 * This eliminates OPFS race conditions when running tests in parallel.
 */

import { test as base } from '@playwright/test';

/**
 * Extended test with worker-isolated page navigation.
 *
 * Automatically appends ?testWorker={workerIndex} to all page.goto() calls,
 * ensuring each worker uses its own database instance.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const workerIndex = testInfo.workerIndex;

    // Override goto to automatically append worker index
    const originalGoto = page.goto.bind(page);

    page.goto = async (url: string, options?: Parameters<typeof page.goto>[1]) => {
      const urlWithWorker = appendWorkerIndex(url, workerIndex);
      return originalGoto(urlWithWorker, options);
    };

    await use(page);
  }
});

/**
 * Append the worker index as a query parameter to a URL.
 */
function appendWorkerIndex(url: string, workerIndex: number): string {
  // Handle relative URLs (starting with /)
  if (url.startsWith('/')) {
    const hasQuery = url.includes('?');
    const separator = hasQuery ? '&' : '?';
    return `${url}${separator}testWorker=${workerIndex}`;
  }

  // Handle absolute URLs
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('testWorker', String(workerIndex));
    return parsed.toString();
  } catch {
    // If URL parsing fails, just append as query string
    const hasQuery = url.includes('?');
    const separator = hasQuery ? '&' : '?';
    return `${url}${separator}testWorker=${workerIndex}`;
  }
}

export { expect } from '@playwright/test';
