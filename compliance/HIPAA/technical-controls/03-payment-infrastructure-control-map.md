# Payment Infrastructure Technical Control Map (HIPAA)

This map ties payment infrastructure policy controls to concrete implementation and test evidence per HIPAA Security Rule requirements.

## Sentinel Controls

| Sentinel | Description | HIPAA Standard | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-PAY-001` | HMAC-SHA256 webhook signature verification | 164.312(e)(2)(i) | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-002` | Replay attack prevention via event age validation | 164.312(d) | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts) | [`packages/api/src/lib/revenuecat.test.ts`](../../../packages/api/src/lib/revenuecat.test.ts), [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-003` | Idempotent event processing via unique event_id | 164.312(c)(1), 164.312(c)(2) | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-004` | Full webhook payload storage for audit trail | 164.312(b) | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |
| `TL-PAY-005` | Organization membership verification for billing access | 164.312(a)(1), 164.312(a)(2)(i) | [`packages/api/src/routes/billing/getOrganizationsOrganizationId.ts`](../../../packages/api/src/routes/billing/getOrganizationsOrganizationId.ts) | [`packages/api/src/routes/billing/billing.test.ts`](../../../packages/api/src/routes/billing/billing.test.ts) |
| `TL-PAY-006` | Entitlement state tracking with event attribution | 164.312(c)(1), 164.312(c)(2) | [`packages/db/src/schema/definition.ts`](../../../packages/db/src/schema/definition.ts), [`packages/api/src/routes/revenuecat/postWebhooks.ts`](../../../packages/api/src/routes/revenuecat/postWebhooks.ts) | [`packages/api/src/routes/revenuecat/revenuecat.test.ts`](../../../packages/api/src/routes/revenuecat/revenuecat.test.ts) |

## HIPAA Technical Safeguards Coverage

### 164.312(a) - Access Control

| Standard | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| 164.312(a)(1) | Access Control | TL-PAY-005 | Organization-scoped billing accounts |
| 164.312(a)(2)(i) | Unique User Identification | TL-PAY-005 | Membership verification before billing data access |

### 164.312(b) - Audit Controls

| Standard | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| 164.312(b) | Audit Controls | TL-PAY-004 | Full payload storage with timestamps, event type, organization ID |

### 164.312(c) - Integrity

| Standard | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| 164.312(c)(1) | Integrity | TL-PAY-003, TL-PAY-006 | Idempotent processing, state integrity tracking |
| 164.312(c)(2) | Mechanism to Authenticate ePHI | TL-PAY-003, TL-PAY-006 | Event attribution via event_id and timestamps |

### 164.312(d) - Person or Entity Authentication

| Standard | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| 164.312(d) | Person or Entity Authentication | TL-PAY-002 | Timestamp validation prevents replay attacks |

### 164.312(e) - Transmission Security

| Standard | Description | Sentinel | Implementation |
| --- | --- | --- | --- |
| 164.312(e)(1) | Transmission Security | TL-PAY-001 | HMAC signature verification on inbound webhooks |
| 164.312(e)(2)(i) | Integrity Controls | TL-PAY-001 | SHA-256 cryptographic hash algorithm |

## Implementation Files

### Core Library

| File | Purpose | HIPAA Standards |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.ts` | Signature verification, replay validation | 164.312(d), 164.312(e) |
| `packages/api/src/lib/revenuecat-observability.ts` | Metrics collection | 164.312(b) |

### Route Handlers

| File | Purpose | HIPAA Standards |
| --- | --- | --- |
| `packages/api/src/routes/revenuecat/postWebhooks.ts` | Webhook handler | 164.312(b), 164.312(c), 164.312(e) |
| `packages/api/src/routes/billing/getOrganizationsOrganizationId.ts` | Billing status endpoint | 164.312(a) |

### Database Schema

| File | Purpose | HIPAA Standards |
| --- | --- | --- |
| `packages/db/src/schema/definition.ts` | Billing tables | 164.312(b), 164.312(c) |
| `packages/api/src/migrations/v019.ts` | Migration | 164.312(b) |

## Test Evidence

| Test File | Controls Verified | HIPAA Standards |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.test.ts` | TL-PAY-001, TL-PAY-002 | 164.312(d), 164.312(e) |
| `packages/api/src/routes/revenuecat/revenuecat.test.ts` | TL-PAY-001-006 | All |
| `packages/api/src/routes/billing/billing.test.ts` | TL-PAY-005 | 164.312(a) |

## Configuration Evidence

| Environment Variable | Control | HIPAA Standards | Description |
| --- | --- | --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | TL-PAY-001 | 164.312(e) | HMAC-SHA256 secret |
| `REVENUECAT_WEBHOOK_MAX_AGE_SECONDS` | TL-PAY-002 | 164.312(d) | Maximum event age |
| `REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS` | TL-PAY-002 | 164.312(d) | Maximum future skew |

## Administrative Safeguards Support

While this technical control map focuses on Technical Safeguards (164.312), the payment infrastructure also supports:

### 164.308(a)(1)(ii)(D) - Information System Activity Review

Webhook observability metrics enable information system activity review by tracking:

- Event processing outcomes (accepted, rejected, duplicate)
- Processing duration
- Error rates and types
- Organization-level activity patterns

### 164.308(a)(8) - Evaluation

The quarterly procedure execution supports periodic technical and non-technical evaluation requirements.

## Documentation (164.316)

This control map and associated policies/procedures satisfy:

- **164.316(a)**: Policies and Procedures - Implement reasonable and appropriate policies
- **164.316(b)(1)**: Documentation - Maintain written records
- **164.316(b)(2)(i)**: Time Limit - Retain documentation for 6 years
