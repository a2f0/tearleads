import type { PrincipalRecoveryContext } from "./principalRecoveryDirectory";
import type { PrincipalRecoveryMemo } from "./principalRecoveryMemo";
import { recoverCurrentOrganizationPolicy } from "./recoverCurrentOrganizationPolicy";
import {
  type RecoverScopedPrincipalPolicyHistoryOptions,
  recoverScopedPrincipalPolicyHistoryInBatch,
} from "./recoverScopedPrincipalPolicyHistory";

/** Internal runtime batch: shared results never outlive one caller's collection. */
export function createScopedPrincipalPolicyHistoryBatch() {
  const memo: PrincipalRecoveryMemo = {
    directories: new Map(),
    admins: new Map(),
  };
  return {
    recover: (options: RecoverScopedPrincipalPolicyHistoryOptions) =>
      recoverScopedPrincipalPolicyHistoryInBatch(options, memo),
    currentOrganization: (options: PrincipalRecoveryContext) =>
      recoverCurrentOrganizationPolicy(options, memo),
  };
}
