/**
 * Analytics logging module for tracking database operations.
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  lte,
  max,
  min,
  sql,
  sum
} from 'drizzle-orm';
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

  const results =
    conditions.length > 0 ? await query.where(and(...conditions)) : await query;

  // Map drizzle results to our interface
  return results.map((row) => ({
    id: row.id,
    eventName: row.eventName,
    durationMs: row.durationMs,
    success: row.success,
    timestamp: row.timestamp
  }));
}

/**
 * Get statistics for analytics events grouped by event name.
 */
export async function getEventStats(
  db: Database,
  options: Omit<GetEventsOptions, 'limit'> = {}
): Promise<EventStats[]> {
  const { eventName, startTime, endTime } = options;

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

  const results = await db
    .select({
      eventName: analyticsEvents.eventName,
      count: count(),
      totalDuration: sum(analyticsEvents.durationMs),
      minDuration: min(analyticsEvents.durationMs),
      maxDuration: max(analyticsEvents.durationMs),
      successCount: sql<number>`sum(case when ${analyticsEvents.success} then 1 else 0 end)`
    })
    .from(analyticsEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(analyticsEvents.eventName);

  return results.map((row) => {
    const totalCount = row.count ?? 0;
    const totalDuration = Number(row.totalDuration) || 0;

    return {
      eventName: row.eventName,
      count: totalCount,
      avgDurationMs:
        totalCount > 0 ? Math.round(totalDuration / totalCount) : 0,
      minDurationMs: Number(row.minDuration) || 0,
      maxDurationMs: Number(row.maxDuration) || 0,
      successRate:
        totalCount > 0
          ? Math.round((Number(row.successCount) / totalCount) * 100)
          : 0
    };
  });
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
  const result = await db.select({ count: count() }).from(analyticsEvents);
  return result[0]?.count ?? 0;
}
