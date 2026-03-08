# Account Management Technical Control Map

This map ties account-management policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-ACCT-001` | Password baseline enforcement at registration (min 12 + uppercase/lowercase/number/symbol) | [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts), [`packages/api/src/connect/services/auth/shared.ts`](../../../packages/api/src/connect/services/auth/shared.ts), [`packages/api/src/connect/services/auth/register.ts`](../../../packages/api/src/connect/services/auth/register.ts), [`packages/client/src/components/auth/RegisterForm.tsx`](../../../packages/client/src/components/auth/RegisterForm.tsx) | [`packages/api/src/connect/authService.test.ts`](../../../packages/api/src/connect/authService.test.ts), [`packages/client/src/components/auth/RegisterForm.test.tsx`](../../../packages/client/src/components/auth/RegisterForm.test.tsx) |
| `TL-ACCT-002` | Disable action records actor and timestamp; active sessions revoked | [`packages/api/src/connect/services/adminDirectUsers.ts`](../../../packages/api/src/connect/services/adminDirectUsers.ts) | [`packages/api/src/connect/services/adminServiceV2.ts`](../../../packages/api/src/connect/services/adminServiceV2.ts) |
| `TL-ACCT-003` | Deletion-mark action records actor and timestamp | [`packages/api/src/connect/services/adminDirectUsers.ts`](../../../packages/api/src/connect/services/adminDirectUsers.ts) | [`packages/api/src/connect/services/adminServiceV2.ts`](../../../packages/api/src/connect/services/adminServiceV2.ts) |

## Notes

- This is the first scoped policy/procedure/control mapping for SOC2 in this repository.
- Additional account-management controls (for example, disabled-login enforcement) can be introduced as new sentinel IDs in this file.
