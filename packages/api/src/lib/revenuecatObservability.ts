type RevenueCatWebhookOutcome =
  | 'accepted'
  | 'duplicate'
  | 'invalid_signature'
  | 'invalid_payload'
  | 'misconfigured_secret'
  | 'unsupported_event_type'
  | 'replay_window_rejected'
  | 'processing_error'
  | 'ingest_error';

type RevenueCatWebhookMetric = {
  outcome: RevenueCatWebhookOutcome;
  durationMs: number;
  eventType?: string;
  eventId?: string;
  organizationId?: string | null;
  reason?: string;
};

type RevenueCatWebhookMetricsSnapshot = {
  total: number;
  updatedAt: string | null;
  outcomes: Record<RevenueCatWebhookOutcome, number>;
  eventTypes: Record<string, number>;
};

const outcomeCounters: Record<RevenueCatWebhookOutcome, number> = {
  accepted: 0,
  duplicate: 0,
  invalid_signature: 0,
  invalid_payload: 0,
  misconfigured_secret: 0,
  unsupported_event_type: 0,
  replay_window_rejected: 0,
  processing_error: 0,
  ingest_error: 0
};

const eventTypeCounters = new Map<string, number>();

let totalEvents = 0;
let updatedAt: Date | null = null;

function incrementEventTypeCounter(eventType: string): void {
  const normalized = eventType.trim().toUpperCase();
  if (!normalized) {
    return;
  }
  eventTypeCounters.set(
    normalized,
    (eventTypeCounters.get(normalized) ?? 0) + 1
  );
}

export function recordRevenueCatWebhookMetric(
  metric: RevenueCatWebhookMetric
): void {
  outcomeCounters[metric.outcome] += 1;
  totalEvents += 1;
  updatedAt = new Date();

  if (metric.eventType) {
    incrementEventTypeCounter(metric.eventType);
  }

  if (process.env['NODE_ENV'] !== 'test') {
    console.info('RevenueCat webhook metric:', {
      outcome: metric.outcome,
      durationMs: metric.durationMs,
      eventType: metric.eventType ?? null,
      eventId: metric.eventId ?? null,
      organizationId: metric.organizationId ?? null,
      reason: metric.reason ?? null
    });
  }
}

export function getRevenueCatWebhookMetricsSnapshot(): RevenueCatWebhookMetricsSnapshot {
  return {
    total: totalEvents,
    updatedAt: updatedAt?.toISOString() ?? null,
    outcomes: {
      accepted: outcomeCounters.accepted,
      duplicate: outcomeCounters.duplicate,
      invalid_signature: outcomeCounters.invalid_signature,
      invalid_payload: outcomeCounters.invalid_payload,
      misconfigured_secret: outcomeCounters.misconfigured_secret,
      unsupported_event_type: outcomeCounters.unsupported_event_type,
      replay_window_rejected: outcomeCounters.replay_window_rejected,
      processing_error: outcomeCounters.processing_error,
      ingest_error: outcomeCounters.ingest_error
    },
    eventTypes: Object.fromEntries(eventTypeCounters.entries())
  };
}

export function resetRevenueCatWebhookMetricsForTests(): void {
  totalEvents = 0;
  updatedAt = null;
  for (const outcome of Object.keys(
    outcomeCounters
  ) as RevenueCatWebhookOutcome[]) {
    outcomeCounters[outcome] = 0;
  }
  eventTypeCounters.clear();
}
