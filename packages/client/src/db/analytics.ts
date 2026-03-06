/**
 * Re-export analytics module from @tearleads/analytics package.
 */

export type {
  AnalyticsEvent,
  AnalyticsEventSlug,
  DatabaseInsert
} from '@tearleads/analytics/analytics';
export {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEventStats,
  getEvents,
  logApiEvent,
  logEvent,
  measureOperation
} from '@tearleads/analytics/analytics';
