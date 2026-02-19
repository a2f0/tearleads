export interface AnalyticsEvent {
  id: string;
  eventName: string;
  durationMs: number;
  success: boolean;
  timestamp: Date;
  detail: unknown;
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

export interface EventStats {
  eventName: string;
  count: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  successRate: number;
}
