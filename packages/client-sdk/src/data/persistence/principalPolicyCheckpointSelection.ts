import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
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
