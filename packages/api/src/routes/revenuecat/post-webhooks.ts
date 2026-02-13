import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import type { Pool } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import type { BillingEntitlementStatus } from '../../lib/revenuecat.js';
import {
  isSupportedRevenueCatEventType,
  mapRevenueCatEntitlementStatus,
  mapRevenueCatWillRenew,
  parseRevenueCatAppUserId,
  parseRevenueCatEventPayload,
  parseUnixMillisTimestamp,
  validateRevenueCatReplayWindow,
  verifyRevenueCatWebhookSignature
} from '../../lib/revenuecat.js';
import { recordRevenueCatWebhookMetric } from '../../lib/revenuecat-observability.js';

const SIGNATURE_HEADER = 'x-revenuecat-signature';
const REPLAY_MAX_AGE_SECONDS_ENV = 'REVENUECAT_WEBHOOK_MAX_AGE_SECONDS';
const REPLAY_MAX_FUTURE_SKEW_SECONDS_ENV =
  'REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS';
const DEFAULT_REPLAY_MAX_AGE_SECONDS = 24 * 60 * 60;
const DEFAULT_REPLAY_MAX_FUTURE_SKEW_SECONDS = 5 * 60;

type ExistingOrganizationRow = {
  id: string;
};

type InsertWebhookEventRow = {
  event_id: string;
};

type IgnoreReason =
  | 'unsupported_event_type'
  | 'missing_event_timestamp'
  | 'event_too_old'
  | 'event_too_far_in_future';

function parseNonNegativeIntegerEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(
      `RevenueCat setup warning: ${key} must be a non-negative integer. Using default ${defaultValue}.`
    );
    return defaultValue;
  }

  return parsed;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown processing error';
}

async function markWebhookEventProcessed(
  pool: Pool,
  eventId: string,
  processingError: string | null
): Promise<void> {
  await pool.query(
    `UPDATE revenuecat_webhook_events
     SET processed_at = $2,
         processing_error = $3
     WHERE event_id = $1`,
    [eventId, new Date(), processingError]
  );
}

async function processBillingUpdate(
  pool: Pool,
  organizationId: string,
  revenueCatAppUserId: string,
  eventId: string,
  eventAt: Date,
  entitlementStatus: BillingEntitlementStatus | null,
  productId: string | null,
  periodEndsAt: Date | null,
  willRenew: boolean | null
): Promise<void> {
  const now = new Date();

  await pool.query(
    `INSERT INTO organization_billing_accounts (
       organization_id,
       revenuecat_app_user_id,
       entitlement_status,
       active_product_id,
       period_ends_at,
       will_renew,
       last_webhook_event_id,
       last_webhook_at,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       COALESCE($3, 'inactive'),
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $9
     )
     ON CONFLICT (organization_id) DO UPDATE
     SET revenuecat_app_user_id = EXCLUDED.revenuecat_app_user_id,
         entitlement_status = COALESCE($3, organization_billing_accounts.entitlement_status),
         active_product_id = COALESCE($4, organization_billing_accounts.active_product_id),
         period_ends_at = COALESCE($5, organization_billing_accounts.period_ends_at),
         will_renew = COALESCE($6, organization_billing_accounts.will_renew),
         last_webhook_event_id = $7,
         last_webhook_at = $8,
         updated_at = $9`,
    [
      organizationId,
      revenueCatAppUserId,
      entitlementStatus,
      productId,
      periodEndsAt,
      willRenew,
      eventId,
      eventAt,
      now
    ]
  );
}

/**
 * @openapi
 * /revenuecat/webhooks:
 *   post:
 *     summary: Receive RevenueCat webhooks
 *     description: Ingests RevenueCat webhook events and updates organization billing state.
 *     tags:
 *       - Billing
 *     responses:
 *       200:
 *         description: Webhook accepted
 *       400:
 *         description: Invalid webhook payload
 *       401:
 *         description: Invalid webhook signature
 *       500:
 *         description: Server error
 */
export const postWebhooksHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const startedAtMs = Date.now();
  const emitMetric = (
    outcome:
      | 'accepted'
      | 'duplicate'
      | 'invalid_signature'
      | 'invalid_payload'
      | 'misconfigured_secret'
      | 'unsupported_event_type'
      | 'replay_window_rejected'
      | 'processing_error'
      | 'ingest_error',
    options: {
      eventType?: string;
      eventId?: string;
      organizationId?: string | null;
      reason?: string;
    } = {}
  ): void => {
    const metric = {
      outcome,
      durationMs: Date.now() - startedAtMs
    };

    if (options.eventType !== undefined) {
      Object.assign(metric, { eventType: options.eventType });
    }
    if (options.eventId !== undefined) {
      Object.assign(metric, { eventId: options.eventId });
    }
    if (options.organizationId !== undefined) {
      Object.assign(metric, { organizationId: options.organizationId });
    }
    if (options.reason !== undefined) {
      Object.assign(metric, { reason: options.reason });
    }

    recordRevenueCatWebhookMetric(metric);
  };

  const webhookSecret = process.env['REVENUECAT_WEBHOOK_SECRET'];
  if (!webhookSecret) {
    console.error(
      'RevenueCat setup error: REVENUECAT_WEBHOOK_SECRET is not configured.'
    );
    emitMetric('misconfigured_secret', { reason: 'missing_webhook_secret' });
    res
      .status(500)
      .json({ error: 'RevenueCat webhook secret is not configured' });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    emitMetric('invalid_payload', { reason: 'raw_body_missing' });
    res.status(400).json({ error: 'Webhook payload must be raw JSON bytes' });
    return;
  }

  const signature = req.get(SIGNATURE_HEADER);
  if (!verifyRevenueCatWebhookSignature(req.body, signature, webhookSecret)) {
    emitMetric('invalid_signature', {
      reason: 'signature_verification_failed'
    });
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const parsedPayload = parseRevenueCatEventPayload(req.body);
  if (!parsedPayload) {
    emitMetric('invalid_payload', { reason: 'invalid_payload_shape' });
    res.status(400).json({ error: 'Invalid RevenueCat webhook payload' });
    return;
  }

  const maxAgeSeconds = parseNonNegativeIntegerEnv(
    REPLAY_MAX_AGE_SECONDS_ENV,
    DEFAULT_REPLAY_MAX_AGE_SECONDS
  );
  const maxFutureSkewSeconds = parseNonNegativeIntegerEnv(
    REPLAY_MAX_FUTURE_SKEW_SECONDS_ENV,
    DEFAULT_REPLAY_MAX_FUTURE_SKEW_SECONDS
  );

  const { event, rawPayload } = parsedPayload;
  const now = new Date();
  const replayWindowValidation = validateRevenueCatReplayWindow(
    event.event_timestamp_ms,
    now,
    maxAgeSeconds,
    maxFutureSkewSeconds
  );
  const entitlementStatus = mapRevenueCatEntitlementStatus(
    event.type,
    event.period_type
  );
  const willRenew = mapRevenueCatWillRenew(event.type);

  try {
    const pool = await getPostgresPool();

    const organizationIdFromAppUser = parseRevenueCatAppUserId(
      event.app_user_id
    );
    let organizationId: string | null = null;

    if (organizationIdFromAppUser) {
      const orgResult = await pool.query<ExistingOrganizationRow>(
        'SELECT id FROM organizations WHERE id = $1 LIMIT 1',
        [organizationIdFromAppUser]
      );
      if (orgResult.rows[0]) {
        organizationId = organizationIdFromAppUser;
      }
    }

    const insertEventResult = await pool.query<InsertWebhookEventRow>(
      `INSERT INTO revenuecat_webhook_events (
         id,
         event_id,
         event_type,
         organization_id,
         revenuecat_app_user_id,
         payload,
         received_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        randomUUID(),
        event.id,
        event.type,
        organizationId,
        event.app_user_id,
        JSON.stringify(rawPayload),
        now
      ]
    );

    if (!insertEventResult.rows[0]) {
      emitMetric('duplicate', {
        eventType: event.type,
        eventId: event.id,
        organizationId
      });
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    try {
      const ignoredReason: IgnoreReason | null =
        !isSupportedRevenueCatEventType(event.type)
          ? 'unsupported_event_type'
          : replayWindowValidation.valid
            ? null
            : replayWindowValidation.reason;

      if (ignoredReason) {
        await markWebhookEventProcessed(
          pool,
          event.id,
          `Ignored webhook event: ${ignoredReason}`
        );
        emitMetric(
          ignoredReason === 'unsupported_event_type'
            ? 'unsupported_event_type'
            : 'replay_window_rejected',
          {
            eventType: event.type,
            eventId: event.id,
            organizationId,
            reason: ignoredReason
          }
        );
        res.status(200).json({
          received: true,
          duplicate: false,
          ignored: true,
          reason: ignoredReason
        });
        return;
      }

      if (!replayWindowValidation.valid) {
        res.status(500).json({
          error: 'Failed to process RevenueCat webhook'
        });
        return;
      }

      const eventAt = replayWindowValidation.eventAt;
      const periodEndsAt = parseUnixMillisTimestamp(event.expiration_at_ms);

      if (organizationId) {
        await processBillingUpdate(
          pool,
          organizationId,
          event.app_user_id,
          event.id,
          eventAt,
          entitlementStatus,
          event.product_id,
          periodEndsAt,
          willRenew
        );
      }

      await markWebhookEventProcessed(pool, event.id, null);
      emitMetric('accepted', {
        eventType: event.type,
        eventId: event.id,
        organizationId
      });

      res.status(200).json({ received: true, duplicate: false });
    } catch (processingError) {
      const errorMessage = toErrorMessage(processingError);
      await markWebhookEventProcessed(pool, event.id, errorMessage);
      emitMetric('processing_error', {
        eventType: event.type,
        eventId: event.id,
        organizationId,
        reason: errorMessage
      });

      console.error(
        'Failed to process RevenueCat webhook event:',
        processingError
      );
      res.status(500).json({ error: 'Failed to process RevenueCat webhook' });
    }
  } catch (error) {
    emitMetric('ingest_error', {
      eventType: event.type,
      eventId: event.id,
      reason: toErrorMessage(error)
    });
    console.error('Failed to ingest RevenueCat webhook event:', error);
    res.status(500).json({ error: 'Failed to ingest RevenueCat webhook' });
  }
};

export function registerPostWebhooksRoute(routeRouter: RouterType): void {
  routeRouter.post('/webhooks', postWebhooksHandler);
}
