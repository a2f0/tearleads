# Payment Infrastructure Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-PAY-001 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=webhook-signature-verification -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-002 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=replay-attack-prevention -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-003 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=idempotent-event-processing -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-004 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=billing-event-audit-trail -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-005 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=billing-data-authorization -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-006 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=entitlement-state-integrity -->

## Purpose

Define mandatory controls for payment infrastructure security, webhook integrity, billing data protection, and subscription state management per HIPAA Security Rule requirements. This policy establishes requirements for the RevenueCat payment integration and maps implemented controls to HIPAA technical safeguards.

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

1. Security Official (per 164.308(a)(2)) maintains this policy and reviews control evidence.
2. Workforce Security designee approves exceptions and manages billing access.
3. Engineering leads implement and maintain webhook security and billing infrastructure.
4. Information System Activity Review designee monitors payment event processing.

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
11. Policy exceptions require written Security Official approval, defined compensating controls, and an expiration date not to exceed 90 days (`PAY-10`).

## Control Baselines

1. Implemented baseline control: HMAC-SHA256 webhook signature verification with timing-safe comparison (`TL-PAY-001`).
2. Implemented baseline control: Event age validation with configurable max age and future skew tolerance (`TL-PAY-002`).
3. Implemented baseline control: Idempotent processing via unique event ID constraint (`TL-PAY-003`).
4. Implemented baseline control: Full webhook payload storage in JSONB with timestamps (`TL-PAY-004`).
5. Implemented baseline control: Organization membership verification for billing data access (`TL-PAY-005`).
6. Implemented baseline control: Entitlement state tracking with event attribution (`TL-PAY-006`).
7. Program baseline expansion target: enforce and evidence `PAY-07` through `PAY-10` through subsequent control-map updates.

## Framework Mapping

| Sentinel | HIPAA Standard | CFR Reference | Control Outcome |
| --- | --- | --- | --- |
| `TL-PAY-001` | Transmission Security - Integrity Controls | 164.312(e)(1), 164.312(e)(2)(i) | Webhook authenticity verified via cryptographic signature. |
| `TL-PAY-002` | Person or Entity Authentication | 164.312(d) | Stale and future-dated events rejected to prevent replay attacks. |
| `TL-PAY-003` | Integrity - Mechanism to Authenticate ePHI | 164.312(c)(1), 164.312(c)(2) | Duplicate events detected and processed idempotently. |
| `TL-PAY-004` | Audit Controls | 164.312(b) | Billing events logged with full context for audit. |
| `TL-PAY-005` | Access Control - Unique User Identification | 164.312(a)(1), 164.312(a)(2)(i) | Billing data access restricted to authorized organization members. |
| `TL-PAY-006` | Integrity - Mechanism to Authenticate ePHI | 164.312(c)(1), 164.312(c)(2) | Entitlement state transitions tracked with complete attribution. |

## HIPAA Security Rule Alignment

### 164.312(a) - Access Control (Technical Safeguard)

- **164.312(a)(1)**: Access Control - Implement technical policies and procedures for electronic information systems that maintain ePHI to allow access only to authorized persons.
- **164.312(a)(2)(i)**: Unique User Identification (Required) - Assign a unique name/number for identifying and tracking user identity.
- Implementation: Organization-scoped billing accounts with membership verification.

### 164.312(b) - Audit Controls (Technical Safeguard)

- **164.312(b)**: Audit Controls (Required) - Implement hardware, software, and/or procedural mechanisms that record and examine activity in systems containing ePHI.
- Implementation: Full webhook payload storage with timestamps and processing status.

### 164.312(c) - Integrity (Technical Safeguard)

- **164.312(c)(1)**: Integrity - Implement policies and procedures to protect ePHI from improper alteration or destruction.
- **164.312(c)(2)**: Mechanism to Authenticate ePHI (Addressable) - Implement electronic mechanisms to corroborate that ePHI has not been altered.
- Implementation: Idempotent processing, state integrity tracking.

### 164.312(d) - Person or Entity Authentication (Technical Safeguard)

- **164.312(d)**: Person or Entity Authentication (Required) - Implement procedures to verify that a person or entity seeking access is the one claimed.
- Implementation: Webhook signature verification, replay window validation.

### 164.312(e) - Transmission Security (Technical Safeguard)

- **164.312(e)(1)**: Transmission Security - Implement technical security measures to guard against unauthorized access to ePHI being transmitted.
- **164.312(e)(2)(i)**: Integrity Controls (Addressable) - Implement security measures to ensure that electronically transmitted ePHI is not improperly modified.
- Implementation: HMAC-SHA256 signature verification ensures webhook integrity.

## Technical Architecture

### Webhook Processing Flow

```text
RevenueCat → POST /v1/revenuecat/webhooks
           ↓
    Signature Verification (HMAC-SHA256) [164.312(e)(2)(i)]
           ↓
    Replay Window Validation [164.312(d)]
           ↓
    Event Type Validation [164.312(c)(2)]
           ↓
    Idempotency Check [164.312(c)(1)]
           ↓
    Organization Resolution [164.312(a)(2)(i)]
           ↓
    Billing State Update [164.312(c)(1)]
           ↓
    Event Archive Storage [164.312(b)]
```

## Documentation Requirements (164.316)

Per 164.316(b)(1), documentation of policies and procedures must be maintained and made available to those persons responsible for implementing the procedures. This policy document satisfies that requirement for payment infrastructure controls.

Per 164.316(b)(2)(i), documentation must be retained for 6 years from the date of its creation or the date when it last was in effect.
