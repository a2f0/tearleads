import { createHmac, timingSafeEqual } from 'node:crypto';

// COMPLIANCE_SENTINEL: TL-VENDOR-006 | control=revenuecat-vendor
// COMPLIANCE_SENTINEL: TL-PAY-001 | control=webhook-signature-verification
// COMPLIANCE_SENTINEL: TL-PAY-002 | control=replay-attack-prevention

const REVENUECAT_APP_USER_PREFIX = 'org:';
const HEX_REGEX = /^[a-fA-F0-9]+$/;

export type BillingEntitlementStatus =
  | 'inactive'
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'expired';

type RevenueCatWebhookEvent = {
  id: string;
  type: string;
  app_user_id: string;
  product_id: string | null;
  period_type: string | null;
  event_timestamp_ms: number | null;
  expiration_at_ms: number | null;
};

type RevenueCatWebhookPayload = {
  rawPayload: Record<string, unknown>;
  event: RevenueCatWebhookEvent;
};

const SUPPORTED_REVENUECAT_EVENT_TYPES = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'PRODUCT_CHANGE',
  'REFUND',
  'SUBSCRIPTION_EXTENDED'
] as const;

type RevenueCatEventType = (typeof SUPPORTED_REVENUECAT_EVENT_TYPES)[number];

type RevenueCatReplayWindowValidation =
  | {
      valid: true;
      eventAt: Date;
    }
  | {
      valid: false;
      reason:
        | 'missing_event_timestamp'
        | 'event_too_old'
        | 'event_too_far_in_future';
      eventAt: Date | null;
      ageSeconds: number | null;
    };

const SUPPORTED_EVENT_TYPES = new Set<string>(SUPPORTED_REVENUECAT_EVENT_TYPES);

const ACTIVE_EVENT_TYPES = new Set<string>([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED'
]);

const GRACE_PERIOD_EVENT_TYPES = new Set<string>(['BILLING_ISSUE']);
const EXPIRED_EVENT_TYPES = new Set<string>([
  'EXPIRATION',
  'REFUND',
  'SUBSCRIPTION_PAUSED'
]);

const WILL_RENEW_TRUE_EVENT_TYPES = new Set<string>([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION'
]);

const WILL_RENEW_FALSE_EVENT_TYPES = new Set<string>([
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'REFUND',
  'SUBSCRIPTION_PAUSED'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTrimmedString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOptionalNumber(
  record: Record<string, unknown>,
  key: string
): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function normalizeRevenueCatSignature(
  signatureHeader: string | undefined
): string | null {
  if (!signatureHeader) {
    return null;
  }

  const withoutPrefix = signatureHeader.trim().replace(/^sha256=/i, '');
  if (
    withoutPrefix.length === 0 ||
    withoutPrefix.length % 2 !== 0 ||
    !HEX_REGEX.test(withoutPrefix)
  ) {
    return null;
  }

  return withoutPrefix.toLowerCase();
}

export function buildRevenueCatAppUserId(organizationId: string): string {
  return `${REVENUECAT_APP_USER_PREFIX}${organizationId}`;
}

export function parseRevenueCatAppUserId(
  revenueCatAppUserId: string
): string | null {
  if (!revenueCatAppUserId.startsWith(REVENUECAT_APP_USER_PREFIX)) {
    return null;
  }
  const organizationId = revenueCatAppUserId
    .slice(REVENUECAT_APP_USER_PREFIX.length)
    .trim();
  return organizationId.length > 0 ? organizationId : null;
}

export function verifyRevenueCatWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret.trim()) {
    return false;
  }

  const normalizedSignature = normalizeRevenueCatSignature(signatureHeader);
  if (!normalizedSignature) {
    return false;
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const provided = Buffer.from(normalizedSignature, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

export function parseRevenueCatEventPayload(
  rawBody: Buffer
): RevenueCatWebhookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const eventValue = parsed['event'];
  if (!isRecord(eventValue)) {
    return null;
  }

  const eventId = getTrimmedString(eventValue, 'id');
  const eventType = getTrimmedString(eventValue, 'type');
  const appUserId = getTrimmedString(eventValue, 'app_user_id');
  if (!eventId || !eventType || !appUserId) {
    return null;
  }

  return {
    rawPayload: parsed,
    event: {
      id: eventId,
      type: eventType,
      app_user_id: appUserId,
      product_id: getTrimmedString(eventValue, 'product_id'),
      period_type: getTrimmedString(eventValue, 'period_type'),
      event_timestamp_ms: getOptionalNumber(eventValue, 'event_timestamp_ms'),
      expiration_at_ms: getOptionalNumber(eventValue, 'expiration_at_ms')
    }
  };
}

export function mapRevenueCatEntitlementStatus(
  eventType: string,
  periodType: string | null
): BillingEntitlementStatus | null {
  const normalizedEventType = eventType.trim().toUpperCase();

  if (ACTIVE_EVENT_TYPES.has(normalizedEventType)) {
    if (periodType?.trim().toLowerCase() === 'trial') {
      return 'trialing';
    }
    return 'active';
  }

  if (GRACE_PERIOD_EVENT_TYPES.has(normalizedEventType)) {
    return 'grace_period';
  }

  if (EXPIRED_EVENT_TYPES.has(normalizedEventType)) {
    return 'expired';
  }

  return null;
}

export function mapRevenueCatWillRenew(eventType: string): boolean | null {
  const normalizedEventType = eventType.trim().toUpperCase();

  if (WILL_RENEW_TRUE_EVENT_TYPES.has(normalizedEventType)) {
    return true;
  }

  if (WILL_RENEW_FALSE_EVENT_TYPES.has(normalizedEventType)) {
    return false;
  }

  return null;
}

export function isSupportedRevenueCatEventType(
  eventType: string
): eventType is RevenueCatEventType {
  return SUPPORTED_EVENT_TYPES.has(eventType.trim().toUpperCase());
}

export function parseUnixMillisTimestamp(
  milliseconds: number | null
): Date | null {
  if (
    milliseconds === null ||
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0
  ) {
    return null;
  }

  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function validateRevenueCatReplayWindow(
  eventTimestampMs: number | null,
  now: Date,
  maxAgeSeconds: number,
  maxFutureSkewSeconds: number
): RevenueCatReplayWindowValidation {
  const eventAt = parseUnixMillisTimestamp(eventTimestampMs);
  if (!eventAt) {
    return {
      valid: false,
      reason: 'missing_event_timestamp',
      eventAt: null,
      ageSeconds: null
    };
  }

  const ageMs = now.getTime() - eventAt.getTime();
  if (ageMs > maxAgeSeconds * 1000) {
    return {
      valid: false,
      reason: 'event_too_old',
      eventAt,
      ageSeconds: Math.floor(ageMs / 1000)
    };
  }

  if (ageMs < -maxFutureSkewSeconds * 1000) {
    return {
      valid: false,
      reason: 'event_too_far_in_future',
      eventAt,
      ageSeconds: Math.floor(Math.abs(ageMs) / 1000)
    };
  }

  return {
    valid: true,
    eventAt
  };
}
