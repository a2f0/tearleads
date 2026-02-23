# Payment Infrastructure Technical Control Map (SOC2)

This map ties payment infrastructure policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-PAY-001` | HMAC-SHA256 webhook signature verification with timing-safe comparison | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) (verifySignature, normalizeSignature, timingSafeEqual), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-002` | Replay attack prevention via event age and future skew validation | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) (isEventInReplayWindow, REVENUECAT_WEBHOOK_MAX_AGE_SECONDS, REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-003` | Idempotent event processing via unique event_id constraint | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts) (revenuecatWebhookEvents table, eventId unique constraint), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-004` | Full webhook payload storage with timestamps for audit trail | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts) (revenuecatWebhookEvents table: payload JSONB, receivedAt, processedAt, processingError) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-005` | Organization membership verification for billing data access | [`packages/api/src/routes/billing/getOrganizationsOrganizationId.ts`](../../../packages/api/src/routes/billing/getOrganizationsOrganizationId.ts) | [`packages/api/src/routes/billing/billing.test.ts`](../../../packages/api/src/routes/billing/billing.test.ts) |
| `TL-PAY-006` | Entitlement state tracking with event attribution | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts) (organizationBillingAccounts table: entitlementStatus, lastWebhookEventId, lastWebhookAt), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |

## Implementation Files

### Core Library

| File | Purpose |
| --- | --- |
| `packages/api/src/lib/revenuecat.ts` | Signature verification, event parsing, replay validation, event type mapping |
| `packages/api/src/lib/revenuecat-observability.ts` | Webhook metrics collection and structured logging |
| `packages/api/src/lib/billing.ts` | Billing utilities export |

### Route Handlers

| File | Purpose |
| --- | --- |
| `packages/api/src/routes/revenuecat.ts` | Router configuration for webhook endpoint |
| `packages/api/src/routes/revenuecat/postWebhooks.ts` | Webhook handler: signature verification, idempotency, state update |
| `packages/api/src/routes/billing/getOrganizationsOrganizationId.ts` | Billing status endpoint with authorization |

### Database Schema

| File | Purpose |
| --- | --- |
| `packages/db/src/schema/definition.ts` | organizationBillingAccounts and revenuecatWebhookEvents table definitions |
| `packages/api/src/migrations/v019.ts` | Migration creating billing tables and initializing existing organizations |

### Shared Types

| File | Purpose |
| --- | --- |
| `packages/shared/src/index.ts` | OrganizationBillingAccount, OrganizationBillingEntitlementStatus types |

## Test Evidence

| Test File | Controls Verified |
| --- | --- |
| `packages/api/src/lib/revenuecat.test.ts` | TL-PAY-001, TL-PAY-002 (signature verification, replay window validation) |
| `packages/api/src/lib/revenuecat-observability.test.ts` | TL-PAY-004 (metrics collection) |
| `packages/api/src/routes/revenuecat/revenuecat.test.ts` | TL-PAY-001, TL-PAY-002, TL-PAY-003, TL-PAY-004, TL-PAY-006 (end-to-end webhook processing) |
| `packages/api/src/routes/billing/billing.test.ts` | TL-PAY-005 (authorization) |

## Configuration Evidence

| Environment Variable | Control | Description |
| --- | --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | TL-PAY-001 | HMAC-SHA256 secret for webhook signature verification |
| `REVENUECAT_WEBHOOK_MAX_AGE_SECONDS` | TL-PAY-002 | Maximum event age (default: 86400 seconds / 24 hours) |
| `REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS` | TL-PAY-002 | Maximum future clock skew tolerance (default: 300 seconds / 5 minutes) |

## Database Schema Evidence

### organization_billing_accounts

```sql
organization_id         TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE
revenuecat_app_user_id  TEXT NOT NULL UNIQUE
entitlement_status      TEXT NOT NULL DEFAULT 'inactive'
active_product_id       TEXT
period_ends_at          TIMESTAMPTZ
will_renew              BOOLEAN
last_webhook_event_id   TEXT
last_webhook_at         TIMESTAMPTZ
created_at              TIMESTAMPTZ NOT NULL
updated_at              TIMESTAMPTZ NOT NULL
```

### revenuecat_webhook_events

```sql
id                      TEXT PRIMARY KEY
event_id                TEXT NOT NULL UNIQUE
event_type              TEXT NOT NULL
organization_id         TEXT REFERENCES organizations(id) ON DELETE SET NULL
revenuecat_app_user_id  TEXT NOT NULL
payload                 JSONB NOT NULL
received_at             TIMESTAMPTZ NOT NULL
processed_at            TIMESTAMPTZ
processing_error        TEXT
```

## Notes

- RevenueCat integration is webhook-only (no outbound API calls to RevenueCat).
- All subscription changes originate from RevenueCat platform; Tearleads stores derived state.
- App user ID format: `org:{organizationId}` enables organization resolution from webhook events.
