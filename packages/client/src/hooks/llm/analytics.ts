/**
 * Analytics utilities for LLM operations.
 */

import { getDatabase } from '@/db';
import type { AnalyticsEventSlug } from '@/db/analytics';
import { logEvent as logAnalyticsEvent } from '@/db/analytics';

/**
 * Log an analytics event for LLM operations.
 * Silently fails if database is not available.
 */
export async function logLLMAnalytics(
  eventName: AnalyticsEventSlug,
  durationMs: number,
  success: boolean
): Promise<void> {
  try {
    const db = getDatabase();
    if (db) {
      await logAnalyticsEvent(db, eventName, durationMs, success);
    }
  } catch {
    // Silently ignore - analytics should never break main functionality
  }
}
