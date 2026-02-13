import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildRevenueCatAppUserId,
  isSupportedRevenueCatEventType,
  mapRevenueCatEntitlementStatus,
  mapRevenueCatWillRenew,
  parseRevenueCatAppUserId,
  parseRevenueCatEventPayload,
  parseUnixMillisTimestamp,
  validateRevenueCatReplayWindow,
  verifyRevenueCatWebhookSignature
} from './revenuecat.js';

describe('revenuecat helpers', () => {
  it('builds and parses organization-scoped app user IDs', () => {
    const appUserId = buildRevenueCatAppUserId('org-123');

    expect(appUserId).toBe('org:org-123');
    expect(parseRevenueCatAppUserId(appUserId)).toBe('org-123');
    expect(parseRevenueCatAppUserId('user:abc')).toBeNull();
    expect(parseRevenueCatAppUserId('org:')).toBeNull();
  });

  it('verifies webhook signatures', () => {
    const rawBody = Buffer.from('{"event":{"id":"evt_1"}}', 'utf8');
    const secret = 'test-secret';
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    expect(
      verifyRevenueCatWebhookSignature(rawBody, signature, secret)
    ).toBeTruthy();
    expect(
      verifyRevenueCatWebhookSignature(rawBody, `sha256=${signature}`, secret)
    ).toBeTruthy();
    expect(
      verifyRevenueCatWebhookSignature(rawBody, 'bad-signature', secret)
    ).toBeFalsy();
  });

  it('parses valid event payloads and rejects invalid payloads', () => {
    const payload = Buffer.from(
      JSON.stringify({
        event: {
          id: 'evt_1',
          type: 'INITIAL_PURCHASE',
          app_user_id: 'org:org-1',
          product_id: 'pro_monthly',
          period_type: 'trial',
          event_timestamp_ms: 1735689600000,
          expiration_at_ms: 1738291200000
        }
      }),
      'utf8'
    );

    const parsed = parseRevenueCatEventPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.event.id).toBe('evt_1');
    expect(parsed?.event.type).toBe('INITIAL_PURCHASE');
    expect(parsed?.event.app_user_id).toBe('org:org-1');
    expect(parsed?.event.product_id).toBe('pro_monthly');

    expect(
      parseRevenueCatEventPayload(Buffer.from('not-json', 'utf8'))
    ).toBeNull();
    expect(
      parseRevenueCatEventPayload(
        Buffer.from(JSON.stringify({ event: { id: 'evt_2' } }), 'utf8')
      )
    ).toBeNull();
  });

  it('maps RevenueCat events to entitlement status and renewal flags', () => {
    expect(mapRevenueCatEntitlementStatus('INITIAL_PURCHASE', 'trial')).toBe(
      'trialing'
    );
    expect(mapRevenueCatEntitlementStatus('RENEWAL', null)).toBe('active');
    expect(mapRevenueCatEntitlementStatus('BILLING_ISSUE', null)).toBe(
      'grace_period'
    );
    expect(mapRevenueCatEntitlementStatus('EXPIRATION', null)).toBe('expired');
    expect(mapRevenueCatEntitlementStatus('TRANSFER', null)).toBeNull();

    expect(mapRevenueCatWillRenew('RENEWAL')).toBeTruthy();
    expect(mapRevenueCatWillRenew('CANCELLATION')).toBeFalsy();
    expect(mapRevenueCatWillRenew('TRANSFER')).toBeNull();
  });

  it('identifies supported RevenueCat webhook event types', () => {
    expect(isSupportedRevenueCatEventType('INITIAL_PURCHASE')).toBeTruthy();
    expect(isSupportedRevenueCatEventType('renewal')).toBeTruthy();
    expect(isSupportedRevenueCatEventType('TRANSFER')).toBeFalsy();
  });

  it('parses UNIX millisecond timestamps safely', () => {
    const parsed = parseUnixMillisTimestamp(1735689600000);
    expect(parsed?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(parseUnixMillisTimestamp(0)).toBeNull();
    expect(parseUnixMillisTimestamp(null)).toBeNull();
  });

  it('validates replay window constraints', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const valid = validateRevenueCatReplayWindow(
      now.getTime() - 60_000,
      now,
      300,
      60
    );
    expect(valid.valid).toBeTruthy();

    const tooOld = validateRevenueCatReplayWindow(
      now.getTime() - 600_000,
      now,
      300,
      60
    );
    expect(tooOld.valid).toBeFalsy();
    if (tooOld.valid) {
      throw new Error('Expected replay validation to fail for old events');
    }
    expect(tooOld.reason).toBe('event_too_old');

    const tooFarInFuture = validateRevenueCatReplayWindow(
      now.getTime() + 180_000,
      now,
      300,
      60
    );
    expect(tooFarInFuture.valid).toBeFalsy();
    if (tooFarInFuture.valid) {
      throw new Error('Expected replay validation to fail for future events');
    }
    expect(tooFarInFuture.reason).toBe('event_too_far_in_future');

    const missingTimestamp = validateRevenueCatReplayWindow(null, now, 300, 60);
    expect(missingTimestamp.valid).toBeFalsy();
    if (missingTimestamp.valid) {
      throw new Error(
        'Expected replay validation to fail for missing timestamps'
      );
    }
    expect(missingTimestamp.reason).toBe('missing_event_timestamp');
  });
});
