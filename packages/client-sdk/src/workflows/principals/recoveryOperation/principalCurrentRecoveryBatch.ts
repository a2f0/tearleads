import { recoverCurrentOrganizationPolicy } from "../historyRecovery/recoverCurrentOrganizationPolicy";
import { createScopedPrincipalPolicyHistoryBatch } from "../historyRecovery/recoverScopedPrincipalPolicyHistory";
import type { PrincipalRecoveryContext } from "./principalRecoveryDirectory";
import type { PrincipalRecoveryMemo } from "./principalRecoveryMemo";

/** Discovery and selected references share one authenticated batch view. */
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
