# Payment Infrastructure Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-PAY-001 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=webhook-signature-verification -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-002 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=replay-attack-prevention -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-003 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=idempotent-event-processing -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-004 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=billing-event-audit-trail -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-005 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=billing-data-authorization -->
<!-- COMPLIANCE_SENTINEL: TL-PAY-006 | policy=compliance/HIPAA/policies/03-payment-infrastructure-policy.md | procedure=compliance/HIPAA/procedures/03-payment-infrastructure-procedure.md | control=entitlement-state-integrity -->

## Frequency

- Execute at least quarterly per 164.308(a)(8) Evaluation requirements.
- Execute after any payment infrastructure change that touches webhook processing, signature verification, or billing data access.
- Execute after RevenueCat SDK updates or API version changes.

## Procedure Steps

### 1. Webhook Signature Verification (`TL-PAY-001`) - 164.312(e)(2)(i)

1. Verify HMAC-SHA256 signature validation is implemented with timing-safe comparison.
2. Verify signature prefix normalization (sha256= prefix handling).
3. Verify invalid signatures result in 401 Unauthorized response.
4. Verify missing webhook secret results in 500 Internal Server Error.

### 2. Replay Attack Prevention (`TL-PAY-002`) - 164.312(d)

1. Verify event timestamp validation against configurable max age window.
2. Verify rejection of events older than REVENUECAT_WEBHOOK_MAX_AGE_SECONDS.
3. Verify rejection of future-dated events beyond REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS.
4. Verify rejected events return appropriate response with reason.

### 3. Idempotent Event Processing (`TL-PAY-003`) - 164.312(c)(1), 164.312(c)(2)

1. Verify unique constraint on event_id in revenuecat_webhook_events table.
2. Verify duplicate events are detected and not reprocessed.
3. Verify duplicate detection returns appropriate response (duplicate: true).
4. Verify database state is not modified by duplicate events.

### 4. Billing Event Audit Trail (`TL-PAY-004`) - 164.312(b)

1. Verify all webhook events are stored with full payload.
2. Verify timestamps (received_at, processed_at) are recorded.
3. Verify processing errors are captured in processing_error field.
4. Verify event_type and revenuecat_app_user_id are indexed for queries.

### 5. Billing Data Authorization (`TL-PAY-005`) - 164.312(a)(1), 164.312(a)(2)(i)

1. Verify GET /v1/billing/organizations/{organizationId} requires authentication.
2. Verify organization membership is validated before returning billing data.
3. Verify unauthorized access results in 403 Forbidden response.
4. Verify billing data is scoped to the requesting organization only.

### 6. Entitlement State Integrity (`TL-PAY-006`) - 164.312(c)(1), 164.312(c)(2)

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
- HIPAA standards addressed: 164.312(a)(1), 164.312(a)(2)(i), 164.312(b), 164.312(c)(1), 164.312(c)(2), 164.312(d), 164.312(e)(1), 164.312(e)(2)(i)
- Test commands run:
- Test result summary:
- Coverage metrics:
- Exceptions or remediation tasks:

## Information System Activity Review (164.308(a)(1)(ii)(D))

This procedure supports the Information System Activity Review requirement by establishing a quarterly review of payment system activity. Reviewers should examine:

1. Webhook processing metrics for anomalies
2. Failed signature verification rates
3. Duplicate event detection rates
4. Processing error trends
5. Access patterns to billing data

## Documentation Retention (164.316(b)(2))

All evidence generated by this procedure must be retained for a minimum of 6 years per HIPAA documentation requirements.
