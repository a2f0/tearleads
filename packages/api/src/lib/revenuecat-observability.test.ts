import { afterEach, describe, expect, it } from 'vitest';
import {
  getRevenueCatWebhookMetricsSnapshot,
  recordRevenueCatWebhookMetric,
  resetRevenueCatWebhookMetricsForTests
} from './revenuecat-observability.js';

describe('revenuecat observability metrics', () => {
  afterEach(() => {
    resetRevenueCatWebhookMetricsForTests();
  });

  it('tracks counters by outcome and event type', () => {
    recordRevenueCatWebhookMetric({
      outcome: 'accepted',
      durationMs: 18,
      eventType: 'renewal',
      eventId: 'evt_1',
      organizationId: 'org-1'
    });

    recordRevenueCatWebhookMetric({
      outcome: 'duplicate',
      durationMs: 4,
      eventType: 'RENEWAL',
      eventId: 'evt_1',
      organizationId: 'org-1'
    });

    recordRevenueCatWebhookMetric({
      outcome: 'replay_window_rejected',
      durationMs: 7,
      eventType: 'INITIAL_PURCHASE',
      reason: 'event_too_old'
    });

    const snapshot = getRevenueCatWebhookMetricsSnapshot();
    expect(snapshot.total).toBe(3);
    expect(snapshot.updatedAt).not.toBeNull();
    expect(snapshot.outcomes.accepted).toBe(1);
    expect(snapshot.outcomes.duplicate).toBe(1);
    expect(snapshot.outcomes.replay_window_rejected).toBe(1);
    expect(snapshot.eventTypes).toEqual({
      RENEWAL: 2,
      INITIAL_PURCHASE: 1
    });
  });
});
