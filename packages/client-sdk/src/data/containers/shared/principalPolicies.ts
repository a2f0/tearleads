import type {
  AnyVerifiedPrincipalPolicy,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { readCanonicalRecord } from "../../keyingCanonicalJson";

export function principalPolicyRequestRecord(
  policy: AnyVerifiedPrincipalPolicy,
  label = "Container principal policy",
): Record<string, unknown> {
  return readCanonicalRecord(
    {
      principalType: policy.principalType,
      principalId: policy.principalId,
      version: policy.version,
      keyEpoch: policy.keyEpoch,
      stateHash: policy.stateHash,
      state: {
        ...policy.state,
        stateHash: policy.stateHash,
      },
      projection: policy.projection,
      grants: policy.grants,
      checkpoint: policy.checkpoint,
    },
    label,
  );
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

export function uniquePrincipalPolicies(
  policies: readonly VerifiedPrincipalPolicy[],
): VerifiedPrincipalPolicy[] {
  const policiesByKey = new Map<string, VerifiedPrincipalPolicy>();

  for (const policy of policies) {
    policiesByKey.set(principalPolicyKey(policy), policy);
  }

  return [...policiesByKey.values()];
}
