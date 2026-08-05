import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { principalPolicyBundleStates } from "../principalPolicyStates";

export function applyPrincipalPolicyReferenceCheckpoint(
  bundle: PrincipalPolicyBundleResponse,
  checkpoint: PrincipalPolicyCheckpoint | null,
): PrincipalPolicyBundleResponse | null {
  if (!checkpoint) {
    return bundle;
  }
  if (
    checkpoint.principalType !== bundle.currentState.principalType ||
    checkpoint.principalId !== bundle.currentState.principalId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "principal policy checkpoint belongs to another principal",
    );
  }
  if (
    !Number.isInteger(checkpoint.version) ||
    checkpoint.version < 1 ||
    checkpoint.stateHash.length === 0
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "principal policy checkpoint is malformed",
    );
  }
  if (bundle.currentState.version < checkpoint.version) {
    return null;
  }
  if (bundle.currentState.version === checkpoint.version) {
    if (bundle.currentState.stateHash !== checkpoint.stateHash) {
      throw new KeyingVerificationError(
        "equivocation",
        "principal policy head conflicts with the local checkpoint",
      );
    }
    return bundle;
  }
  const checkpointStates = principalPolicyBundleStates(bundle).filter(
    (state) => state.version === checkpoint.version,
  );
  if (checkpointStates.length === 0) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "principal policy chain does not extend the local checkpoint",
    );
  }
  if (
    checkpointStates.some((state) => state.stateHash !== checkpoint.stateHash)
  ) {
    throw new KeyingVerificationError(
      "equivocation",
      "principal policy chain conflicts with the local checkpoint",
    );
  }
  return bundle;
}
