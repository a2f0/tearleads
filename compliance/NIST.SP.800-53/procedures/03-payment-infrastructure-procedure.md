# Payment Infrastructure Procedure (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-PAY-001 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=webhook-signature-verification -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-002 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=replay-attack-prevention -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-003 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=idempotent-event-processing -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-004 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=billing-event-audit-trail -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-005 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=billing-data-authorization -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-006 | policy=compliance/NIST.SP.800-53/policies/03-payment-infrastructure-policy.md | procedure=compliance/NIST.SP.800-53/procedures/03-payment-infrastructure-procedure.md | control=entitlement-state-integrity -->

## Frequency

- Execute at least quarterly.
- Execute after any payment infrastructure change that touches webhook processing, signature verification, or billing data access.
- Execute after RevenueCat SDK updates or API version changes.

## Procedure Steps

### 1. Webhook Signature Verification (`TL-PAY-001`) - SC-8, SC-13, SI-10

1. Verify HMAC-SHA256 signature validation is implemented with timing-safe comparison.
2. Verify signature prefix normalization (sha256= prefix handling).
3. Verify invalid signatures result in 401 Unauthorized response.
4. Verify missing webhook secret results in 500 Internal Server Error.

### 2. Replay Attack Prevention (`TL-PAY-002`) - SC-23, SI-10

1. Verify event timestamp validation against configurable max age window.
2. Verify rejection of events older than REVENUECAT_WEBHOOK_MAX_AGE_SECONDS.
3. Verify rejection of future-dated events beyond REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS.
4. Verify rejected events return appropriate response with reason.

### 3. Idempotent Event Processing (`TL-PAY-003`) - SI-7, SI-10

1. Verify unique constraint on event_id in revenuecat_webhook_events table.
2. Verify duplicate events are detected and not reprocessed.
3. Verify duplicate detection returns appropriate response (duplicate: true).
4. Verify database state is not modified by duplicate events.

### 4. Billing Event Audit Trail (`TL-PAY-004`) - AU-2, AU-3, AU-11, AU-12

1. Verify all webhook events are stored with full payload.
2. Verify timestamps (received_at, processed_at) are recorded.
3. Verify processing errors are captured in processing_error field.
4. Verify event_type and revenuecat_app_user_id are indexed for queries.

### 5. Billing Data Authorization (`TL-PAY-005`) - AC-2, AC-3, AC-6

1. Verify GET /v1/billing/organizations/{organizationId} requires authentication.
2. Verify organization membership is validated before returning billing data.
3. Verify unauthorized access results in 403 Forbidden response.
4. Verify billing data is scoped to the requesting organization only.

### 6. Entitlement State Integrity (`TL-PAY-006`) - SI-7, AU-10

1. Verify entitlement status transitions are tracked in organization_billing_accounts.
2. Verify last_webhook_event_id and last_webhook_at are updated on state changes.
3. Verify all supported event types map to correct entitlement states.
4. Verify trial detection based on period_type field.

## Verification Commands

```bash
# Run all RevenueCat webhook tests
pnpm --filter @tearleads/api test -- src/routes/revenuecat.test.ts

# Run RevenueCat helper unit tests
pnpm --filter @tearleads/api test -- src/lib/revenuecat.test.ts

# Run RevenueCat observability tests
pnpm --filter @tearleads/api test -- src/lib/revenuecat-observability.test.ts

# Run billing endpoint tests
pnpm --filter @tearleads/api test -- src/routes/billing.test.ts

# Run all payment-related tests with coverage
pnpm --filter @tearleads/api test:coverage -- --testPathPattern="(revenuecat|billing)"
```

## Evidence Template

- Review date:
- Reviewer:
- Commit SHA:
- Controls verified: `TL-PAY-001`, `TL-PAY-002`, `TL-PAY-003`, `TL-PAY-004`, `TL-PAY-005`, `TL-PAY-006`
- NIST controls addressed: SC-8, SC-13, SC-23, SI-7, SI-10, AU-2, AU-3, AU-10, AU-11, AU-12, AC-2, AC-3, AC-6
- Test commands run:
- Test result summary:
- Coverage metrics:
- Exceptions or remediation tasks:
