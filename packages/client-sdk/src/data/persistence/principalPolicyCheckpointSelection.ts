import type {
  PrincipalPolicyAuthorization,
  PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import { verifyPrincipalPolicyCheckpoint } from "@tearleads/crypto";
import { assertPrincipalPolicyCheckpointShape } from "./keyingCheckpointPersistence";

export function principalPolicyHeadMeetsCheckpoint(
  head: { readonly stateHash: string; readonly version: number },
  checkpoint: PrincipalPolicyCheckpoint | null,
): boolean {
  return (
    !checkpoint ||
    head.version > checkpoint.version ||
    (head.version === checkpoint.version &&
      head.stateHash === checkpoint.stateHash)
  );
}

export function verifiedPrincipalPolicyMeetsCheckpoint(
  policy: PrincipalPolicyAuthorization,
  checkpoint: PrincipalPolicyCheckpoint | null,
): boolean {
  if (!checkpoint) {
    return true;
  }
  assertPrincipalPolicyCheckpointShape(checkpoint, policy);
  if (policy.version < checkpoint.version) {
    return false;
  }
  verifyPrincipalPolicyCheckpoint({
    chain:
      "retainedHistory" in policy
        ? policy.retainedHistory
        : (policy.history ?? []),
    currentState: policy.state,
    localCheckpoint: checkpoint,
  });
  return true;
}
