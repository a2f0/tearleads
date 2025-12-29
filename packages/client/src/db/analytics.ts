/**
 * Analytics logging module for tracking database operations.
 */

import { count } from 'drizzle-orm';
import type { Database } from './index';
import { getDatabaseAdapter } from './index';
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
 * Raw row type from SQLite query
 */
interface RawAnalyticsRow {
  id: string;
  event_name: string;
  duration_ms: number;
  success: number;
  timestamp: number;
}

/**
 * Get analytics events with optional filters.
 * Uses raw SQL for reliable results with sqlite-proxy.
 */
export async function getEvents(
  _db: Database,
  options: GetEventsOptions = {}
): Promise<AnalyticsEvent[]> {
  const { eventName, startTime, endTime, limit = 100 } = options;
  const adapter = getDatabaseAdapter();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventName) {
    conditions.push('event_name = ?');
    params.push(eventName);
  }

  if (startTime) {
    conditions.push('timestamp >= ?');
    params.push(startTime.getTime());
  }

  if (endTime) {
    conditions.push('timestamp <= ?');
    params.push(endTime.getTime());
  }

  let query = 'SELECT * FROM analytics_events';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY timestamp DESC';
  query += ` LIMIT ${limit}`;

  const result = await adapter.execute(query, params);
  const rows = result.rows as unknown as RawAnalyticsRow[];

  return rows.map((row) => ({
    id: String(row.id),
    eventName: String(row.event_name),
    durationMs: Number(row.duration_ms) || 0,
    success: Boolean(row.success),
    timestamp: new Date(row.timestamp)
  }));
}

/**
 * Raw stats row type from SQLite query
 */
interface RawStatsRow {
  event_name: string;
  count: number;
  total_duration: number;
  min_duration: number;
  max_duration: number;
  success_count: number;
}

/**
 * Get statistics for analytics events grouped by event name.
 * Uses raw SQL for reliable results with sqlite-proxy.
 */
export async function getEventStats(
  _db: Database,
  options: Omit<GetEventsOptions, 'limit'> = {}
): Promise<EventStats[]> {
  const { eventName, startTime, endTime } = options;
  const adapter = getDatabaseAdapter();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventName) {
    conditions.push('event_name = ?');
    params.push(eventName);
  }
  if (startTime) {
    conditions.push('timestamp >= ?');
    params.push(startTime.getTime());
  }
  if (endTime) {
    conditions.push('timestamp <= ?');
    params.push(endTime.getTime());
  }

  let query = `
    SELECT
      event_name,
      COUNT(*) as count,
      SUM(duration_ms) as total_duration,
      MIN(duration_ms) as min_duration,
      MAX(duration_ms) as max_duration,
      SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count
    FROM analytics_events
  `;

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' GROUP BY event_name';

  const result = await adapter.execute(query, params);
  const rows = result.rows as unknown as RawStatsRow[];

  return rows.map((row) => {
    const totalCount = Number(row.count) || 0;
    const totalDuration = Number(row.total_duration) || 0;

    return {
      eventName: String(row.event_name),
      count: totalCount,
      avgDurationMs:
        totalCount > 0 ? Math.round(totalDuration / totalCount) : 0,
      minDurationMs: Number(row.min_duration) || 0,
      maxDurationMs: Number(row.max_duration) || 0,
      successRate:
        totalCount > 0
          ? Math.round((Number(row.success_count) / totalCount) * 100)
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
