import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyRef } from "@tearleads/validators/request";

type CitedPolicy = Pick<
  VerifiedPrincipalPolicy,
  "principalId" | "principalType" | "stateHash" | "version"
>;

/** Cite a principal policy head the way a container mutation request does. */
export function principalPolicyRef(policy: CitedPolicy): PrincipalPolicyRef {
  return {
    principalType: policy.principalType,
    principalId: policy.principalId,
    version: policy.version,
    stateHash: policy.stateHash,
  };
}

export function principalPolicyRefs(
  policies: readonly CitedPolicy[],
): PrincipalPolicyRef[] {
  return policies.map(principalPolicyRef);
}
