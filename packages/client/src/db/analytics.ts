/**
 * Re-export analytics module from @tearleads/analytics package.
 */

export {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEvents,
  getEventStats,
  logApiEvent,
  logEvent,
  measureOperation
} from '@tearleads/analytics/analytics';

export type {
  AnalyticsEvent,
  AnalyticsEventSlug,
  DatabaseInsert
} from '@tearleads/analytics/analytics';
