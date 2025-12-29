/**
 * Analytics logging module for tracking database operations.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Database } from './index';
import { analyticsEvents } from './schema';

export interface AnalyticsEvent {
  id: string;
  eventName: string;
  durationMs: number;
  success: boolean;
  timestamp: Date;
}

export interface GetEventsOptions {
  eventName?: string | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  limit?: number | undefined;
}

export interface EventStats {
  eventName: string;
  count: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  successRate: number;
}

/**
 * Generate a UUID for event IDs.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Log an analytics event to the database.
 */
export async function logEvent(
  db: Database,
  eventName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  await db.insert(analyticsEvents).values({
    id: generateId(),
    eventName,
    durationMs: Math.round(durationMs),
    success,
    timestamp: new Date()
  });
}

/**
 * Measure an async operation and log its duration.
 * Returns the result of the operation.
 */
export async function measureOperation<T>(
  db: Database,
  eventName: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = performance.now();
  let success = true;

  try {
    const result = await operation();
    return result;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - startTime;
    try {
      await logEvent(db, eventName, durationMs, success);
    } catch {
      // Don't let logging errors affect the main operation
      console.warn(`Failed to log analytics event: ${eventName}`);
    }
  }
}

/**
 * Get analytics events with optional filters.
 */
export async function getEvents(
  db: Database,
  options: GetEventsOptions = {}
): Promise<AnalyticsEvent[]> {
  const { eventName, startTime, endTime, limit = 100 } = options;

  const conditions = [];

  if (eventName) {
    conditions.push(eq(analyticsEvents.eventName, eventName));
  }

  if (startTime) {
    conditions.push(gte(analyticsEvents.timestamp, startTime));
  }

  if (endTime) {
    conditions.push(lte(analyticsEvents.timestamp, endTime));
  }

  const query = db
    .select()
    .from(analyticsEvents)
    .orderBy(desc(analyticsEvents.timestamp))
    .limit(limit);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

/**
 * Get statistics for analytics events grouped by event name.
 */
export async function getEventStats(
  db: Database,
  options: Omit<GetEventsOptions, 'limit'> = {}
): Promise<EventStats[]> {
  const events = await getEvents(db, { ...options, limit: 10000 });

  const statsMap = new Map<
    string,
    {
      count: number;
      totalDuration: number;
      minDuration: number;
      maxDuration: number;
      successCount: number;
    }
  >();

  for (const event of events) {
    const existing = statsMap.get(event.eventName);
    if (existing) {
      existing.count++;
      existing.totalDuration += event.durationMs;
      existing.minDuration = Math.min(existing.minDuration, event.durationMs);
      existing.maxDuration = Math.max(existing.maxDuration, event.durationMs);
      if (event.success) existing.successCount++;
    } else {
      statsMap.set(event.eventName, {
        count: 1,
        totalDuration: event.durationMs,
        minDuration: event.durationMs,
        maxDuration: event.durationMs,
        successCount: event.success ? 1 : 0
      });
    }
  }

  return Array.from(statsMap.entries()).map(([eventName, stats]) => ({
    eventName,
    count: stats.count,
    avgDurationMs: Math.round(stats.totalDuration / stats.count),
    minDurationMs: stats.minDuration,
    maxDurationMs: stats.maxDuration,
    successRate: Math.round((stats.successCount / stats.count) * 100)
  }));
}

/**
 * Clear all analytics events.
 */
export async function clearEvents(db: Database): Promise<void> {
  await db.delete(analyticsEvents);
}

/**
 * Get the count of events.
 */
export async function getEventCount(db: Database): Promise<number> {
  const result = await db.select().from(analyticsEvents);
  return result.length;
}
