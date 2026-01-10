/**
 * Analytics logging module for tracking database operations.
 */

import { isRecord, toFiniteNumber } from '@rapid/shared';
import type { Database } from './index';
import { getDatabaseAdapter } from './index';
import { analyticsEvents } from './schema';

export type DatabaseInsert = Pick<Database, 'insert'>;
export interface AnalyticsEvent {
  id: string;
  eventName: string;
  durationMs: number;
  success: boolean;
  timestamp: Date;
}

export type SortColumn = 'eventName' | 'durationMs' | 'success' | 'timestamp';
export type SortDirection = 'asc' | 'desc';

export type StatsSortColumn =
  | 'eventName'
  | 'count'
  | 'avgDurationMs'
  | 'minDurationMs'
  | 'maxDurationMs'
  | 'successRate';

export interface GetEventsOptions {
  eventName?: string | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  limit?: number | undefined;
  sortColumn?: SortColumn | undefined;
  sortDirection?: SortDirection | undefined;
}

/**
 * Maps sort column names to SQL column names.
 */
const SORT_COLUMN_MAP: Record<SortColumn, string> = {
  eventName: 'event_name',
  durationMs: 'duration_ms',
  success: 'success',
  timestamp: 'timestamp'
};

/**
 * Maps stats sort column names to SQL expressions for ORDER BY.
 */
const STATS_SORT_COLUMN_MAP: Record<StatsSortColumn, string> = {
  eventName: 'event_name',
  count: 'count(*)',
  avgDurationMs: 'sum(duration_ms) * 1.0 / count(*)',
  minDurationMs: 'min(duration_ms)',
  maxDurationMs: 'max(duration_ms)',
  successRate: 'sum(case when success then 1 else 0 end) * 100.0 / count(*)'
};

export interface EventStats {
  eventName: string;
  count: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  successRate: number;
}

export interface GetEventStatsOptions {
  eventName?: string | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  sortColumn?: StatsSortColumn | undefined;
  sortDirection?: SortDirection | undefined;
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
  db: DatabaseInsert,
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
  db: DatabaseInsert,
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
 * Raw row type from SQLite query result.
 * Uses camelCase property names via explicit SQL aliases.
 */
interface RawAnalyticsRow {
  id: string;
  eventName: string;
  durationMs: number;
  success: number; // SQLite stores as 0/1
  timestamp: number; // milliseconds since epoch
}

function normalizeAnalyticsRow(value: unknown): RawAnalyticsRow | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value['id'] !== 'string' ||
    typeof value['eventName'] !== 'string'
  ) {
    return null;
  }

  const durationMs = toFiniteNumber(value['durationMs']);
  const success = toFiniteNumber(value['success']);
  const timestamp = toFiniteNumber(value['timestamp']);

  if (durationMs === null || success === null || timestamp === null) {
    return null;
  }

  return {
    id: value['id'],
    eventName: value['eventName'],
    durationMs,
    success,
    timestamp
  };
}

/**
 * Get analytics events with optional filters.
 * Uses raw SQL via adapter to avoid drizzle ORM's column name mapping issues with sqlite-proxy.
 */
export async function getEvents(
  _db: Database,
  options: GetEventsOptions = {}
): Promise<AnalyticsEvent[]> {
  const {
    eventName,
    startTime,
    endTime,
    limit = 100,
    sortColumn,
    sortDirection
  } = options;
  const adapter = getDatabaseAdapter();

  // Build SQL query with conditions - use explicit aliases for camelCase property names
  let sql = `SELECT id, event_name as eventName, duration_ms as durationMs, success, timestamp FROM analytics_events`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventName) {
    conditions.push(`event_name = ?`);
    params.push(eventName);
  }

  if (startTime) {
    conditions.push(`timestamp >= ?`);
    params.push(startTime.getTime());
  }

  if (endTime) {
    conditions.push(`timestamp <= ?`);
    params.push(endTime.getTime());
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  // Build ORDER BY clause - use dynamic column if specified, otherwise default to timestamp DESC
  if (sortColumn && sortDirection) {
    const sqlColumn = SORT_COLUMN_MAP[sortColumn];
    const sqlDirection = sortDirection === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sqlColumn} ${sqlDirection}`;
  } else {
    sql += ` ORDER BY timestamp DESC`;
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  // Execute raw SQL via adapter
  const result = await adapter.execute(sql, params);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const normalizedRows = rows
    .map(normalizeAnalyticsRow)
    .filter((row): row is RawAnalyticsRow => row !== null);

  return normalizedRows.map((row) => ({
    id: row.id,
    eventName: row.eventName,
    durationMs: row.durationMs,
    success: Boolean(row.success),
    timestamp: new Date(row.timestamp)
  }));
}

/**
 * Raw stats row type from SQLite query result.
 */
interface RawStatsRow {
  eventName: string;
  count: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  successCount: number;
}

function normalizeStatsRow(value: unknown): RawStatsRow | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value['eventName'] !== 'string') {
    return null;
  }

  const count = toFiniteNumber(value['count']) ?? 0;
  const totalDuration = toFiniteNumber(value['totalDuration']) ?? 0;
  const minDuration = toFiniteNumber(value['minDuration']) ?? 0;
  const maxDuration = toFiniteNumber(value['maxDuration']) ?? 0;
  const successCount = toFiniteNumber(value['successCount']) ?? 0;

  return {
    eventName: value['eventName'],
    count,
    totalDuration,
    minDuration,
    maxDuration,
    successCount
  };
}

/**
 * Get statistics for analytics events grouped by event name.
 * Uses raw SQL via adapter to avoid drizzle ORM's column name mapping issues.
 */
export async function getEventStats(
  _db: Database,
  options: GetEventStatsOptions = {}
): Promise<EventStats[]> {
  const { eventName, startTime, endTime, sortColumn, sortDirection } = options;
  const adapter = getDatabaseAdapter();

  // Build SQL query with conditions
  let sql = `
    SELECT
      event_name as eventName,
      count(*) as count,
      sum(duration_ms) as totalDuration,
      min(duration_ms) as minDuration,
      max(duration_ms) as maxDuration,
      sum(case when success then 1 else 0 end) as successCount
    FROM analytics_events
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventName) {
    conditions.push(`event_name = ?`);
    params.push(eventName);
  }

  if (startTime) {
    conditions.push(`timestamp >= ?`);
    params.push(startTime.getTime());
  }

  if (endTime) {
    conditions.push(`timestamp <= ?`);
    params.push(endTime.getTime());
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ` GROUP BY event_name`;

  // Build ORDER BY clause
  if (sortColumn && sortDirection) {
    const sqlExpression = STATS_SORT_COLUMN_MAP[sortColumn];
    const sqlDirection = sortDirection === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sqlExpression} ${sqlDirection}`;
  }

  // Execute raw SQL via adapter
  const result = await adapter.execute(sql, params);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const normalizedRows = rows
    .map(normalizeStatsRow)
    .filter((row): row is RawStatsRow => row !== null);

  return normalizedRows.map((row) => {
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
export async function clearEvents(_db: Database): Promise<void> {
  const adapter = getDatabaseAdapter();
  await adapter.execute(`DELETE FROM analytics_events`, []);
}

/**
 * Log an API call event directly via the database adapter.
 * This function can be called from modules that don't have access to the Database instance.
 * Uses raw SQL via adapter to avoid needing the Drizzle db instance.
 */
export async function logApiEvent(
  eventName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  try {
    const adapter = getDatabaseAdapter();
    await adapter.execute(
      `INSERT INTO analytics_events (id, event_name, duration_ms, success, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        eventName,
        Math.round(durationMs),
        success ? 1 : 0,
        Date.now()
      ]
    );
  } catch (error) {
    // Don't let logging errors affect API calls, but log for debugging
    console.warn(`Failed to log API event '${eventName}':`, error);
  }
}

/**
 * Get the count of events.
 */
export async function getEventCount(_db: Database): Promise<number> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT count(*) as count FROM analytics_events`,
    []
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const firstRow = rows[0];
  if (!isRecord(firstRow)) {
    return 0;
  }
  const count = toFiniteNumber(firstRow['count']);
  return count ?? 0;
}

interface EventNameRow {
  eventName: string;
}

function isEventNameRow(row: unknown): row is EventNameRow {
  return isRecord(row) && typeof row['eventName'] === 'string';
}

/**
 * Get all distinct event types.
 */
export async function getDistinctEventTypes(_db: Database): Promise<string[]> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT DISTINCT event_name as eventName FROM analytics_events ORDER BY event_name`,
    []
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const eventTypes: string[] = [];
  for (const row of rows) {
    if (isEventNameRow(row)) {
      eventTypes.push(row['eventName']);
    }
  }
  return eventTypes;
}
