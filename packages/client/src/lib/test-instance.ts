/**
 * Test instance utilities for Playwright parallel test isolation.
 *
 * When running Playwright tests with multiple workers, each worker needs
 * its own isolated database instance to avoid OPFS race conditions.
 *
 * Workers pass their index via URL query param: ?testWorker=0, ?testWorker=1, etc.
 * The app detects this and uses a deterministic instance ID for that worker.
 */

const TEST_WORKER_PARAM = 'testWorker';
const TEST_INSTANCE_PREFIX = 'test-worker-';

/**
 * Check if the app is running in Playwright test mode.
 */
export function isTestMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has(TEST_WORKER_PARAM);
}

/**
 * Get the test worker index from the URL, or null if not in test mode.
 */
export function getTestWorkerIndex(): number | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const workerParam = params.get(TEST_WORKER_PARAM);
  if (workerParam === null) return null;

  const index = parseInt(workerParam, 10);
  return Number.isFinite(index) && index >= 0 ? index : null;
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
