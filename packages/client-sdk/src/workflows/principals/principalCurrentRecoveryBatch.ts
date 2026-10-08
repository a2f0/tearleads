import type { PrincipalRecoveryContext } from "./principalRecoveryDirectory";
import type { PrincipalRecoveryMemo } from "./principalRecoveryMemo";
import { recoverCurrentOrganizationPolicy } from "./recoverCurrentOrganizationPolicy";
import { createScopedPrincipalPolicyHistoryBatch } from "./recoverScopedPrincipalPolicyHistory";

/** Discovery and selected references share one authenticated collection view. */
export function createPrincipalCurrentRecoveryBatch() {
  const memo: PrincipalRecoveryMemo = {
    directories: new Map(),
    admins: new Map(),
  };
  return {
    recover: createScopedPrincipalPolicyHistoryBatch(memo),
    discover: (input: PrincipalRecoveryContext) =>
      recoverCurrentOrganizationPolicy(input, memo),
  };
}
