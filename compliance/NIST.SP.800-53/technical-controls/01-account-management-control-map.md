# Account Management Technical Control Map (NIST SP 800-53)

This map ties NIST account-management controls to implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-NACCT-001` | Provisioning and authenticator baseline enforcement for account creation | [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts), [`packages/api/src/routes/auth/shared.ts`](../../../packages/api/src/routes/auth/shared.ts), [`packages/api/src/routes/auth/postRegister.ts`](../../../packages/api/src/routes/auth/postRegister.ts), [`packages/client/src/components/auth/RegisterForm.tsx`](../../../packages/client/src/components/auth/RegisterForm.tsx) | [`packages/api/src/routes/auth.test.ts`](../../../packages/api/src/routes/auth.test.ts), [`packages/client/src/components/auth/RegisterForm.test.tsx`](../../../packages/client/src/components/auth/RegisterForm.test.tsx) |
| `TL-NACCT-002` | Attributable disablement/deletion-mark actions and session revocation | [`packages/api/src/routes/admin/users/patchId.ts`](../../../packages/api/src/routes/admin/users/patchId.ts), [`packages/api/src/migrations/v017.ts`](../../../packages/api/src/migrations/v017.ts) | [`packages/api/src/routes/admin/users.patch.orgs.test.ts`](../../../packages/api/src/routes/admin/users.patch.orgs.test.ts) |
| `TL-NACCT-003` | Account lifecycle auditability and periodic access-review evidence | [`compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md`](../procedures/01-account-management-procedure.md) | [`compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md`](../procedures/01-account-management-procedure.md) |

## Notes

1. Current implementation evidence emphasizes AC-2, IA-5, and AU control themes.
2. Procedural review evidence supplements automated tests for recurring access review controls.
3. Future hardening can add direct automation for role review export and audit packet generation.
