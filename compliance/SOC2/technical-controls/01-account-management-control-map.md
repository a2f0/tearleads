# Account Management Technical Control Map

This map ties account-management policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-ACCT-001` | Password baseline enforcement at registration (min 12 + uppercase/lowercase/number/symbol) | [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts), [`packages/api/src/routes/auth/shared.ts`](../../../packages/api/src/routes/auth/shared.ts), [`packages/api/src/routes/auth/postRegister.ts`](../../../packages/api/src/routes/auth/postRegister.ts), [`packages/client/src/components/auth/RegisterForm.tsx`](../../../packages/client/src/components/auth/RegisterForm.tsx) | [`packages/api/src/routes/auth/auth.test.ts`](../../../packages/api/src/routes/auth/auth.test.ts), [`packages/client/src/components/auth/RegisterForm.test.tsx`](../../../packages/client/src/components/auth/RegisterForm.test.tsx) |
| `TL-ACCT-002` | Disable action records actor and timestamp; active sessions revoked | [`packages/api/src/routes/admin/users/patchId.ts`](../../../packages/api/src/routes/admin/users/patchId.ts) | [`packages/api/src/routes/admin/users.patch.orgs.test.ts`](../../../packages/api/src/routes/admin/users.patch.orgs.test.ts) |
| `TL-ACCT-003` | Deletion-mark action records actor and timestamp | [`packages/api/src/routes/admin/users/patchId.ts`](../../../packages/api/src/routes/admin/users/patchId.ts) | [`packages/api/src/routes/admin/users.patch.orgs.test.ts`](../../../packages/api/src/routes/admin/users.patch.orgs.test.ts) |

## Notes

- This is the first scoped policy/procedure/control mapping for SOC2 in this repository.
- Additional account-management controls (for example, disabled-login enforcement) can be introduced as new sentinel IDs in this file.
