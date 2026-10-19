import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyRef } from "@tearleads/validators/request";
import type { PrincipalPolicyCurrentEvidence } from "../../principals/principalPolicyEvidence";

/**
 * The head a container mutation cites for a policy it was planned against.
 * The API authorizes from its own verified copy of that head, so the policy
 * itself never travels.
 */
export function principalPolicyRef(
  policy: Pick<
    VerifiedPrincipalPolicy,
    "principalId" | "principalType" | "stateHash" | "version"
  >,
): PrincipalPolicyRef {
  return {
    principalType: policy.principalType,
    principalId: policy.principalId,
    version: policy.version,
    stateHash: policy.stateHash,
  };
}

function principalPolicyKey(
  policy: Pick<
    VerifiedPrincipalPolicy,
    "keyEpoch" | "principalId" | "principalType" | "stateHash" | "version"
  >,
): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.keyEpoch,
    policy.stateHash,
  ].join(":");
}

export function uniquePrincipalPolicies<
  T extends PrincipalPolicyCurrentEvidence,
>(policies: readonly T[]): T[] {
  const policiesByKey = new Map<string, T>();

  for (const policy of policies) {
    policiesByKey.set(principalPolicyKey(policy), policy);
  }

  return [...policiesByKey.values()];
}
