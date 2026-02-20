# Account Management Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HACCT-001 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=unique-user-identification -->
<!-- COMPLIANCE_SENTINEL: TL-HACCT-002 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=timely-access-change -->
<!-- COMPLIANCE_SENTINEL: TL-HACCT-003 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=access-review-auditability -->

## Frequency

1. Execute the full validation at least quarterly.
2. Execute after any auth/admin lifecycle change affecting registration, role assignment, disablement, or deletion-marking.
3. Execute after any HIPAA control change request related to access management.

## Procedure Steps

1. Validate unique-user account creation and credential baseline enforcement in registration/auth flows.
2. Validate access change and deprovisioning attribution fields for administrative workflows.
3. Validate that disablement behavior revokes active sessions for disabled users.
4. Run and document quarterly privileged/ePHI access review outputs.
5. Record evidence package details (commit SHA, commands, timestamps, reviewer, exceptions).

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
- Controls verified: `TL-HACCT-001`, `TL-HACCT-002`, `TL-HACCT-003`
- Test commands run:
- Test result summary:
- Access review artifact reference:
- Exceptions or remediation tasks:
