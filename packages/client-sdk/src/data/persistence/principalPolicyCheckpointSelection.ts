import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  KeyingVerificationError,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { ExecSql } from "../sqlite/sqlSchema";
import { loadPrincipalPolicyCheckpoint } from "./keyingCheckpointPersistence";

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
  policy: VerifiedPrincipalPolicy,
  checkpoint: PrincipalPolicyCheckpoint | null,
): boolean {
  if (!checkpoint) {
    return true;
  }
  if (
    checkpoint.principalType !== policy.principalType ||
    checkpoint.principalId !== policy.principalId
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
  if (policy.version < checkpoint.version) {
    return false;
  }
  verifyPrincipalPolicyCheckpoint({
    chain: policy.history ?? [],
    currentState: policy.state,
    localCheckpoint: checkpoint,
  });
  return true;
}

export async function loadPrincipalPolicyVerificationCheckpoint(input: {
  readonly execSql: ExecSql;
  readonly principalId: string;
  readonly principalType: ManagedPrincipalKind;
}): Promise<PrincipalPolicyCheckpoint | null> {
  return loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.principalType,
    input.principalId,
  );
}
