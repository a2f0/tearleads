import type {
  AnyVerifiedPrincipalPolicy,
  VerifiedPrincipalPolicy,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";

export type PrincipalPolicyCurrentEvidence =
  | VerifiedPrincipalPolicy
  | VerifiedPrincipalPolicyCurrent;
export type PrincipalPolicyCheckpointEvidence =
  | AnyVerifiedPrincipalPolicy
  | VerifiedPrincipalPolicyCurrent;

export function principalPolicyEvidenceEntries(
  policy: PrincipalPolicyCheckpointEvidence,
): NonNullable<VerifiedPrincipalPolicy["history"]> {
  return "retainedHistory" in policy
    ? policy.retainedHistory
    : (policy.history ?? [
        {
          state: policy.state,
          projection: policy.projection,
          grants: policy.grants,
        },
      ]);
}
