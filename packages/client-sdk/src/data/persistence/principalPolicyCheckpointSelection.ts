import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyPrincipalPolicyCheckpoint } from "@tearleads/crypto";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  assertPrincipalPolicyCheckpointShape,
  loadPrincipalPolicyCheckpoint,
} from "./keyingCheckpointPersistence";

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
  assertPrincipalPolicyCheckpointShape(checkpoint, policy);
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
