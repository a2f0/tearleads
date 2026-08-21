import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
} from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import { principalPolicyBundleStates } from "../principalPolicyStates";
import { assertPrincipalPolicyCheckpointShape } from "./keyingCheckpointPersistence";

export function applyPrincipalPolicyReferenceCheckpoint(
  bundle: PrincipalPolicyBundleResponse,
  checkpoint: PrincipalPolicyCheckpoint | null,
): PrincipalPolicyBundleResponse | null {
  if (!checkpoint) {
    return bundle;
  }
  assertPrincipalPolicyCheckpointShape(checkpoint, bundle.currentState);
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
