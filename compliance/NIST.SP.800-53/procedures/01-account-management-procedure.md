# Account Management Procedure (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NACCT-001 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=account-provisioning-authenticator-baseline -->
<!-- COMPLIANCE_SENTINEL: TL-NACCT-002 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=account-disable-attribution -->
<!-- COMPLIANCE_SENTINEL: TL-NACCT-003 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=access-review-auditability -->

## Frequency

1. Execute full validation at least quarterly.
2. Execute after any account lifecycle implementation change.
3. Execute during control assessment preparation for AC/AU/IA families.

## Procedure Steps

1. Validate provisioning controls for identity association and credential baseline requirements.
2. Validate access-modification and disablement attribution fields, plus session revocation behavior.
3. Validate deletion-marking attribution fields.
4. Validate quarterly privileged access review artifacts and remediation tracking.
5. Record evidence package details (commit SHA, reviewer, date, commands, findings, exceptions).

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
- Controls verified: `TL-NACCT-001`, `TL-NACCT-002`, `TL-NACCT-003`
- Test commands run:
- Test result summary:
- Access review artifact reference:
- Exceptions or remediation tasks:
