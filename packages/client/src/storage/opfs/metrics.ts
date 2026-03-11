/**
 * Metrics helpers for file storage operations.
 */

import type { DatabaseInsert } from '@/db/analytics';
import { logEvent } from '@/db/analytics';
import type { RetrieveMetrics, StoreMetrics } from './types';

type OpfsLogEvent = typeof logEvent;

let opfsLogEvent: OpfsLogEvent = logEvent;

function assertOpfsMetricsTestingHookRuntime(): void {
  if (import.meta.env.MODE !== 'test') {
    throw new Error(
      'opfs metrics testing hooks are only available in test mode.'
    );
  }
}

/**
 * Overrides `logEvent` for tests.
 *
 * @remarks
 * This mutates module-level state and is intended only for tests.
 * It is not safe for concurrent tests that require different logger mocks.
 * Pair with `resetOpfsMetricsRuntimeForTesting` in `afterEach`/`beforeEach`.
 */
export function setOpfsLogEventForTesting(logEventImpl: OpfsLogEvent): void {
  assertOpfsMetricsTestingHookRuntime();
  opfsLogEvent = logEventImpl;
}

/**
 * Resets `logEvent` to the default implementation.
 *
 * @remarks
 * Use this between tests to avoid state leaking across test cases.
 */
export function resetOpfsMetricsRuntimeForTesting(): void {
  assertOpfsMetricsTestingHookRuntime();
  opfsLogEvent = logEvent;
}

/**
 * Create a logger callback for file retrieval metrics.
 * Use this with measureRetrieve() to log decryption times to analytics.
 */
export function createRetrieveLogger(
  db: DatabaseInsert
): (metrics: RetrieveMetrics) => Promise<void> {
  return async (metrics: RetrieveMetrics) => {
    try {
      await opfsLogEvent(
        db,
        'file_decrypt',
        metrics.durationMs,
        metrics.success
      );
    } catch (err) {
      // Don't let logging errors affect the main operation
      console.warn('Failed to log file_decrypt analytics event:', err);
    }
  };
}

/**
 * Create a logger callback for file store metrics.
 * Use this with measureStore() to log encryption times to analytics.
 */
export function createStoreLogger(
  db: DatabaseInsert
): (metrics: StoreMetrics) => Promise<void> {
  return async (metrics: StoreMetrics) => {
    try {
      await opfsLogEvent(
        db,
        'file_encrypt',
        metrics.durationMs,
        metrics.success
      );
    } catch (err) {
      // Don't let logging errors affect the main operation
      console.warn('Failed to log file_encrypt analytics event:', err);
    }
  };
}

/**
 * Shared helper to measure retrieve operations.
 * Used by both OPFSStorage and CapacitorStorage.
 */
export async function measureRetrieveHelper(
  retrieveFn: () => Promise<Uint8Array>,
  storagePath: string,
  onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
): Promise<Uint8Array> {
  const startTime = performance.now();
  let success = true;
  let fileSize = 0;

  try {
    const data = await retrieveFn();
    fileSize = data.byteLength;
    return data;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - startTime;
    if (onMetrics) {
      // Fire and forget - don't block on metrics callback
      Promise.resolve(
        onMetrics({ storagePath, durationMs, success, fileSize })
      ).catch((err) => {
        // Don't block on callback errors, but log for debugging
        console.warn('onMetrics callback failed in measureRetrieve:', err);
      });
    }
  }
}

/**
 * Shared helper to measure store operations.
 * Used by both OPFSStorage and CapacitorStorage.
 */
export async function measureStoreHelper(
  storeFn: () => Promise<string>,
  inputSize: number,
  onMetrics?: (metrics: StoreMetrics) => void | Promise<void>
): Promise<string> {
  const startTime = performance.now();
  let success = true;
  let storagePath = '';

  try {
    storagePath = await storeFn();
    return storagePath;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - startTime;
    if (onMetrics) {
      // Fire and forget - don't block on metrics callback
      Promise.resolve(
        onMetrics({ storagePath, durationMs, success, fileSize: inputSize })
      ).catch((err) => {
        // Don't block on callback errors, but log for debugging
        console.warn('onMetrics callback failed in measureStore:', err);
      });
    }
  }
}
