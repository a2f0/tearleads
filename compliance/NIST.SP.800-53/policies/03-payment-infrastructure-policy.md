# Payment Infrastructure Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-PAY-001 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=webhook-signature-verification -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-002 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=replay-attack-prevention -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-003 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=idempotent-event-processing -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-004 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=billing-event-audit-trail -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-005 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=billing-data-authorization -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-006 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=entitlement-state-integrity -->

## Purpose

Define mandatory controls for payment infrastructure security, webhook integrity, billing data protection, and subscription state management per NIST SP 800-53 requirements. This policy establishes requirements for the RevenueCat payment integration and maps implemented controls to NIST control families.

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

1. Information System Security Officer (ISSO) maintains this policy and reviews control evidence.
2. System Owner approves exceptions and authorizes payment system changes.
3. Engineering leads implement and maintain webhook security and billing infrastructure.
4. Security Operations monitors payment event processing and escalates anomalies.

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

| Sentinel | NIST SP 800-53 Controls | Control Outcome |
| --- | --- | --- |
| `TL-PAY-001` | SC-8, SC-13, SI-10 | Webhook authenticity verified via cryptographic signature before processing. |
| `TL-PAY-002` | SC-23, SI-10 | Stale and future-dated events rejected to prevent replay attacks. |
| `TL-PAY-003` | SI-10, SI-7 | Duplicate events detected and processed idempotently. |
| `TL-PAY-004` | AU-2, AU-3, AU-11, AU-12 | Billing events logged with full context for audit and investigation. |
| `TL-PAY-005` | AC-2, AC-3, AC-6 | Billing data access restricted to authorized organization members. |
| `TL-PAY-006` | SI-7, AU-10 | Entitlement state transitions tracked with complete attribution. |

## NIST Control Family Alignment

### SC - System and Communications Protection

- **SC-8**: Transmission Confidentiality and Integrity - HMAC signature verification ensures webhook integrity.
- **SC-13**: Cryptographic Protection - SHA-256 cryptographic hash for signature verification.
- **SC-23**: Session Authenticity - Replay window validation prevents session replay attacks.

### SI - System and Information Integrity

- **SI-7**: Software, Firmware, and Information Integrity - Idempotent processing ensures data integrity.
- **SI-10**: Information Input Validation - Webhook payload validation and signature verification.

### AU - Audit and Accountability

- **AU-2**: Event Logging - Billing events identified for logging.
- **AU-3**: Content of Audit Records - Full payload with timestamps and context.
- **AU-10**: Non-repudiation - Event attribution via event_id and timestamps.
- **AU-11**: Audit Record Retention - Webhook events retained for compliance.
- **AU-12**: Audit Record Generation - Automatic event archival on webhook receipt.

### AC - Access Control

- **AC-2**: Account Management - Organization-scoped billing accounts.
- **AC-3**: Access Enforcement - Membership verification before billing data access.
- **AC-6**: Least Privilege - Users can only access their organization's billing data.

## Technical Architecture

### Webhook Processing Flow

```text
RevenueCat → POST /v1/revenuecat/webhooks
           ↓
    Signature Verification (HMAC-SHA256) [SC-8, SC-13, SI-10]
           ↓
    Replay Window Validation [SC-23]
           ↓
    Event Type Validation [SI-10]
           ↓
    Idempotency Check [SI-7]
           ↓
    Organization Resolution [AC-2, AC-3]
           ↓
    Billing State Update [SI-7]
           ↓
    Event Archive Storage [AU-2, AU-3, AU-12]
```
