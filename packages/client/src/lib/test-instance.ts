/**
 * Test instance utilities for Playwright parallel test isolation.
 *
 * When running Playwright tests with multiple workers, each worker needs
 * its own isolated database instance to avoid OPFS race conditions.
 *
 * Workers inject their index via addInitScript as a global variable.
 * The app detects this and uses a deterministic instance ID for that worker.
 */

/**
 * Global variable name used to receive worker index from Playwright.
 * Must match the name used in tests/fixtures.ts
 */
const WORKER_INDEX_GLOBAL = '__PLAYWRIGHT_WORKER_INDEX__';
const TEST_INSTANCE_PREFIX = 'test-worker-';

/**
 * Check if the app is running in Playwright test mode.
 */
export function isTestMode(): boolean {
  return getTestWorkerIndex() !== null;
}

/**
 * Get the test worker index from the injected global, or null if not in test mode.
 */
export function getTestWorkerIndex(): number | null {
  if (typeof window === 'undefined') return null;
  const index = (window as unknown as Record<string, unknown>)[
    WORKER_INDEX_GLOBAL
  ];
  return typeof index === 'number' && Number.isFinite(index) && index >= 0
    ? index
    : null;
}

/**
 * Get a deterministic instance ID for the current test worker.
 * Returns null if not in test mode.
 */
export function getTestInstanceId(): string | null {
  const workerIndex = getTestWorkerIndex();
  if (workerIndex === null) return null;
  return `${TEST_INSTANCE_PREFIX}${workerIndex}`;
}

/**
 * Check if an instance ID is a test instance.
 */
export function isTestInstance(instanceId: string): boolean {
  return instanceId.startsWith(TEST_INSTANCE_PREFIX);
}
