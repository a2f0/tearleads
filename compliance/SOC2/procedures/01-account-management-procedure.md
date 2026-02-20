# Account Management Procedure (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=account-disable-attribution -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=deletion-marking-attribution -->

## Frequency

- Execute at least quarterly.
- Execute after any auth/admin lifecycle change that touches account registration, disablement, or deletion lifecycle fields.

## Procedure Steps

1. Validate password complexity enforcement (minimum length and composition requirements).
2. Validate disablement attribution fields and session revocation behavior.
3. Validate deletion-marking attribution fields.
4. Record evidence (commit, test run, timestamp, reviewer).

## Verification Commands

```bash
pnpm --filter @tearleads/api test -- src/routes/auth.test.ts
pnpm --filter @tearleads/api test -- src/routes/admin/users.patch.orgs.test.ts
pnpm --filter @tearleads/client test -- src/components/auth/RegisterForm.test.tsx
```

## Evidence Template

- Review date:
- Reviewer:
- Commit SHA:
- Controls verified: `TL-ACCT-001`, `TL-ACCT-002`, `TL-ACCT-003`
- Test commands run:
- Test result summary:
- Exceptions or remediation tasks:
