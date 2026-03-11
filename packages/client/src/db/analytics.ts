/**
 * Re-export analytics module from @tearleads/app-analytics package.
 */

export type {
  AnalyticsEventSlug,
  DatabaseInsert
} from '@tearleads/app-analytics/analytics';
export {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEventStats,
  getEvents,
  logApiEvent,
  logEvent,
  measureOperation
} from '@tearleads/app-analytics/analytics';
