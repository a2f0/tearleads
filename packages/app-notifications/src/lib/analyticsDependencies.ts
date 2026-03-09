import type { ComponentType } from 'react';

export interface AnalyticsEvent {
  timestamp: Date;
  eventName: string;
  durationMs: number;
  success: boolean;
}

export interface EventStats {
  eventName: string;
  count: number;
  avgDurationMs: number;
}

export interface AnalyticsDependencies {
  useDatabaseContext: () => { isUnlocked: boolean };
  getDatabase: () => unknown;
  getEvents: (
    db: unknown,
    options: { startTime: Date; limit: number }
  ) => Promise<AnalyticsEvent[]>;
  getEventStats: (
    db: unknown,
    options: { startTime: Date }
  ) => Promise<EventStats[]>;
  getDistinctEventTypes: (db: unknown) => Promise<string[]>;
  getEventDisplayName: (eventName: string) => string;
  formatDuration: (durationMs: number) => string;
  logError: (message: string, details: string) => void;
  DurationChart: ComponentType<{
    events: AnalyticsEvent[];
    selectedEventTypes: Set<string>;
    timeFilter: 'hour' | 'day' | 'week' | 'all';
  }>;
}

let dependencies: AnalyticsDependencies | null = null;

export function setAnalyticsDependencies(next: AnalyticsDependencies): void {
  dependencies = next;
}

export function getAnalyticsDependencies(): AnalyticsDependencies | null {
  return dependencies;
}
