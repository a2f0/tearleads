# Payment Infrastructure Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-PAY-001 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=webhook-signature-verification -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-002 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=replay-attack-prevention -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-003 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=idempotent-event-processing -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-004 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=billing-event-audit-trail -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-005 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=billing-data-authorization -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-006 | policy=compliance/SOC2/policies/03-payment-infrastructure-policy.md | procedure=compliance/SOC2/procedures/03-payment-infrastructure-procedure.md | control=entitlement-state-integrity -->

## Purpose

Define mandatory controls for payment infrastructure security, webhook integrity, billing data protection, and subscription state management. This policy establishes requirements for the RevenueCat payment integration and maps implemented controls to technical enforcement points.

## Scope

1. RevenueCat webhook ingestion and signature verification.
2. Billing event replay attack prevention.
3. Idempotent event processing and duplicate detection.
4. Billing event audit trail and retention.
5. Organization-scoped billing data authorization.
6. Subscription entitlement state integrity.

## Policy Control Index

1. `PAY-01` Webhook signature verification (`TL-PAY-001`).
2. `PAY-02` Replay attack prevention via event age validation (`TL-PAY-002`).
3. `PAY-03` Idempotent event processing and duplicate detection (`TL-PAY-003`).
4. `PAY-04` Billing event audit trail with full payload retention (`TL-PAY-004`).
5. `PAY-05` Organization-scoped billing data authorization (`TL-PAY-005`).
6. `PAY-06` Entitlement state integrity and transition tracking (`TL-PAY-006`).
7. `PAY-07` Webhook secret management and rotation requirements.
8. `PAY-08` Billing data access logging requirements.
9. `PAY-09` Payment event monitoring and alerting requirements.
10. `PAY-10` Billing exception handling and escalation requirements.

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Engineering leads implement and maintain webhook security and billing infrastructure.
3. Operations monitors payment event processing and escalates anomalies.
4. Compliance owners retain evidence artifacts and track remediation for policy exceptions.

## Policy Statements

1. All incoming webhooks from payment providers must be cryptographically verified using HMAC-SHA256 signature validation before processing (`PAY-01`, `TL-PAY-001`).
2. Webhook events must be rejected if the event timestamp exceeds the configured maximum age window (default: 24 hours) to prevent replay attacks (`PAY-02`, `TL-PAY-002`).
3. Webhook events must be rejected if the event timestamp indicates future time beyond the configured clock skew tolerance (default: 5 minutes) (`PAY-02`, `TL-PAY-002`).
4. Webhook event processing must be idempotent; duplicate events identified by unique event ID must not trigger duplicate state changes (`PAY-03`, `TL-PAY-003`).
5. All webhook events must be stored with full payload, timestamps, and processing status for audit purposes (`PAY-04`, `TL-PAY-004`).
6. Billing data access must be restricted to authorized members of the owning organization (`PAY-05`, `TL-PAY-005`).
7. Entitlement status transitions must be tracked with event attribution, including event ID, event type, and timestamp (`PAY-06`, `TL-PAY-006`).
8. Webhook secrets must be stored as environment variables or secure vault entries; hardcoded secrets are prohibited (`PAY-07`).
9. Failed webhook signature verifications and processing errors must be logged with sufficient detail for security investigation (`PAY-08`).
10. Payment event processing metrics must be collected for anomaly detection and operational monitoring (`PAY-09`).
11. Policy exceptions require written Security Owner approval, defined compensating controls, and an expiration date not to exceed 90 days (`PAY-10`).

## Control Baselines

1. Implemented baseline control: HMAC-SHA256 webhook signature verification with timing-safe comparison (`TL-PAY-001`).
2. Implemented baseline control: Event age validation with configurable max age and future skew tolerance (`TL-PAY-002`).
3. Implemented baseline control: Idempotent processing via unique event ID constraint (`TL-PAY-003`).
4. Implemented baseline control: Full webhook payload storage in JSONB with timestamps (`TL-PAY-004`).
5. Implemented baseline control: Organization membership verification for billing data access (`TL-PAY-005`).
6. Implemented baseline control: Entitlement state tracking with event attribution (`TL-PAY-006`).
7. Program baseline expansion target: enforce and evidence `PAY-07` through `PAY-10` through subsequent control-map updates.

## Framework Mapping

| Sentinel | SOC2 TSC | Control Outcome |
| --- | --- | --- |
| `TL-PAY-001` | CC6.1, CC6.6, CC6.7 | Webhook authenticity verified via cryptographic signature before processing. |
| `TL-PAY-002` | CC6.1, CC6.6 | Stale and future-dated events rejected to prevent replay attacks. |
| `TL-PAY-003` | PI1.2, PI1.3 | Duplicate events detected and processed idempotently. |
| `TL-PAY-004` | CC7.1, CC7.2, CC4.1 | Billing events logged with full context for audit and investigation. |
| `TL-PAY-005` | CC6.1, CC6.3 | Billing data access restricted to authorized organization members. |
| `TL-PAY-006` | PI1.3, PI1.4 | Entitlement state transitions tracked with complete attribution. |

## Technical Architecture

### Webhook Processing Flow

```text
RevenueCat → POST /v1/revenuecat/webhooks
           ↓
    Signature Verification (HMAC-SHA256) [CC6.1, CC6.6, CC6.7]
           ↓
    Replay Window Validation [CC6.1, CC6.6]
           ↓
    Event Type Validation [PI1.2]
           ↓
    Idempotency Check (unique event_id) [PI1.2, PI1.3]
           ↓
    Organization Resolution [CC6.1, CC6.3]
           ↓
    Billing State Update [PI1.3, PI1.4]
           ↓
    Event Archive Storage [CC7.1, CC7.2, CC4.1]
```

### Data Model

- `organization_billing_accounts`: Tracks subscription entitlement state per organization.
- `revenuecat_webhook_events`: Archives all webhook events for audit trail.
