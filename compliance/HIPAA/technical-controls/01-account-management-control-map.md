# Account Management Technical Control Map (HIPAA)

This map ties HIPAA account-management controls to implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-HACCT-001` | Unique user identification and credential baseline enforcement | [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts), [`packages/api/src/routes/auth/shared.ts`](../../../packages/api/src/routes/auth/shared.ts), [`packages/api/src/routes/auth/postRegister.ts`](../../../packages/api/src/routes/auth/postRegister.ts), [`packages/client/src/components/auth/RegisterForm.tsx`](../../../packages/client/src/components/auth/RegisterForm.tsx) | [`packages/api/src/routes/auth/auth.test.ts`](../../../packages/api/src/routes/auth/auth.test.ts), [`packages/client/src/components/auth/RegisterForm.test.tsx`](../../../packages/client/src/components/auth/RegisterForm.test.tsx) |
| `TL-HACCT-002` | Access change/deprovisioning attribution and disablement session revocation | [`packages/api/src/routes/admin/users/patchId.ts`](../../../packages/api/src/routes/admin/users/patchId.ts), [`packages/api/src/migrations/v017.ts`](../../../packages/api/src/migrations/v017.ts) | [`packages/api/src/routes/admin/users.patch.orgs.test.ts`](../../../packages/api/src/routes/admin/users.patch.orgs.test.ts) |
| `TL-HACCT-003` | Account lifecycle auditability and quarterly access-review evidence requirements | [`compliance/HIPAA/procedures/01-account-management-procedure.md`](../procedures/01-account-management-procedure.md) | [`compliance/HIPAA/procedures/01-account-management-procedure.md`](../procedures/01-account-management-procedure.md) |

## Notes

1. The first two controls are primarily technically enforced through application routes and tests.
2. `TL-HACCT-003` currently relies on procedural evidence collection and reviewer sign-off.
3. Additional automation for access review evidence aggregation can be introduced as a future control expansion.
