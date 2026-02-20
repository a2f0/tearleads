/**
 * Types for analytics module.
 */

import type { Database } from '@tearleads/db/sqlite';
import type { AnalyticsEventDetail } from './analyticsEvents';

export type DatabaseInsert = Pick<Database, 'insert'>;

export interface AnalyticsEvent {
  id: string;
  eventName: string;
  durationMs: number;
  success: boolean;
  timestamp: Date;
  detail: AnalyticsEventDetail | null;
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
  offset?: number | undefined;
  sortColumn?: SortColumn | undefined;
  sortDirection?: SortDirection | undefined;
}

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

export interface GetEventCountOptions {
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

/**
 * Raw row type from SQLite query result.
 * Uses camelCase property names via explicit SQL aliases.
 */
export interface RawAnalyticsRow {
  id: string;
  eventName: string;
  durationMs: number;
  success: number; // SQLite stores as 0/1
  timestamp: number; // milliseconds since epoch
  detail: string | null;
}

/**
 * Raw stats row type from SQLite query result.
 */
export interface RawStatsRow {
  eventName: string;
  count: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  successCount: number;
}

/**
 * Maps sort column names to SQL column names.
 */
export const SORT_COLUMN_MAP: Record<SortColumn, string> = {
  eventName: 'event_name',
  durationMs: 'duration_ms',
  success: 'success',
  timestamp: 'timestamp'
};

/**
 * Maps stats sort column names to SQL expressions for ORDER BY.
 */
export const STATS_SORT_COLUMN_MAP: Record<StatsSortColumn, string> = {
  eventName: 'event_name',
  count: 'count(*)',
  avgDurationMs: 'sum(duration_ms) * 1.0 / count(*)',
  minDurationMs: 'min(duration_ms)',
  maxDurationMs: 'max(duration_ms)',
  successRate: 'sum(case when success then 1 else 0 end) * 100.0 / count(*)'
};
