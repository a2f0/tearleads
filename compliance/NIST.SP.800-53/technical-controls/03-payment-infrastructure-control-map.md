# Payment Infrastructure Technical Control Map (NIST SP 800-53)

This map ties payment infrastructure policy controls to concrete implementation and test evidence per NIST SP 800-53 requirements.

## Sentinel Controls

| Sentinel | Description | NIST Controls | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-PAY-001` | HMAC-SHA256 webhook signature verification | SC-8, SC-13, SI-10 | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-002` | Replay attack prevention via event age validation | SC-23, SI-10 | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-003` | Idempotent event processing via unique event_id | SI-7, SI-10 | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-004` | Full webhook payload storage for audit trail | AU-2, AU-3, AU-11, AU-12 | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-005` | Organization membership verification for billing access | AC-2, AC-3, AC-6 | [`packages/api/src/routes/billing/getOrganizationsOrganizationId.ts`](../../../packages/api/src/routes/billing/getOrganizationsOrganizationId.ts) | [`packages/api/src/routes/billing/billing.test.ts`](../../../packages/api/src/routes/billing/billing.test.ts) |
| `TL-PAY-006` | Entitlement state tracking with event attribution | SI-7, AU-10 | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |

## NIST Control Family Coverage

### SC - System and Communications Protection

| Control | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| SC-8 | Transmission Confidentiality and Integrity | TL-PAY-001 | HMAC signature verification on inbound webhooks |
| SC-13 | Cryptographic Protection | TL-PAY-001 | SHA-256 cryptographic hash algorithm |
| SC-23 | Session Authenticity | TL-PAY-002 | Timestamp validation prevents replay attacks |

### SI - System and Information Integrity

| Control | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| SI-7 | Software, Firmware, and Information Integrity | TL-PAY-003, TL-PAY-006 | Idempotent processing, state integrity tracking |
| SI-10 | Information Input Validation | TL-PAY-001, TL-PAY-002, TL-PAY-003 | Signature, timestamp, and payload validation |

### AU - Audit and Accountability

| Control | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| AU-2 | Event Logging | TL-PAY-004 | Billing events identified for logging |
| AU-3 | Content of Audit Records | TL-PAY-004 | Full payload with timestamps, event type, organization ID |
| AU-10 | Non-repudiation | TL-PAY-006 | Event attribution via event_id and timestamps |
| AU-11 | Audit Record Retention | TL-PAY-004 | Webhook events retained in database |
| AU-12 | Audit Record Generation | TL-PAY-004 | Automatic event archival on webhook receipt |

### AC - Access Control

| Control | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| AC-2 | Account Management | TL-PAY-005 | Organization-scoped billing accounts |
| AC-3 | Access Enforcement | TL-PAY-005 | Membership verification before billing data access |
| AC-6 | Least Privilege | TL-PAY-005 | Users access only their organization's billing data |

## Implementation Files

### Core Library

| File | Purpose | NIST Controls |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.ts` | Signature verification, replay validation | SC-8, SC-13, SC-23, SI-10 |
| `packages/api/src/lib/revenuecat-observability.ts` | Metrics collection | AU-2, AU-12 |

### Route Handlers

| File | Purpose | NIST Controls |
| --- | --- | --- |
| `packages/api/src/routes/revenuecat/postWebhooks.ts` | Webhook handler | SC-8, SI-7, SI-10, AU-12 |
| `packages/api/src/routes/billing/getOrganizationsOrganizationId.ts` | Billing status endpoint | AC-2, AC-3, AC-6 |

### Database Schema

| File | Purpose | NIST Controls |
| --- | --- | --- |
| `packages/db/src/schema/definition.ts` | Billing tables | AU-3, AU-11, SI-7 |
| `packages/api/src/migrations/v019.ts` | Migration | AU-11 |

## Test Evidence

| Test File | Controls Verified | NIST Controls |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.test.ts` | TL-PAY-001, TL-PAY-002 | SC-8, SC-13, SC-23, SI-10 |
| `packages/api/src/routes/revenuecat/revenuecat.test.ts` | TL-PAY-001-006 | All |
| `packages/api/src/routes/billing/billing.test.ts` | TL-PAY-005 | AC-2, AC-3, AC-6 |

## Configuration Evidence

| Environment Variable | Control | NIST Controls | Description |
| --- | --- | --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | TL-PAY-001 | SC-8, SC-13 | HMAC-SHA256 secret |
| `REVENUECAT_WEBHOOK_MAX_AGE_SECONDS` | TL-PAY-002 | SC-23 | Maximum event age |
| `REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS` | TL-PAY-002 | SC-23 | Maximum future skew |
