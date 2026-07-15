import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import { loadPrincipalPolicyCheckpoint } from "./keyingCheckpointPersistence";

function checkpointFromBundle(
  bundle: PrincipalPolicyBundleResponse | null,
): PrincipalPolicyCheckpoint | null {
  return bundle
    ? {
        principalType: bundle.currentState.principalType,
        principalId: bundle.currentState.principalId,
        version: bundle.currentState.version,
        stateHash: bundle.currentState.stateHash,
      }
    : null;
}

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

/**
 * Durable checkpoints are authoritative. A newer legacy cache row is retained
 * as a migration fallback until its next successful verification advances the
 * durable checkpoint table.
 */
export async function loadPrincipalPolicyVerificationCheckpoint(input: {
  readonly cachedBundle: PrincipalPolicyBundleResponse | null;
  readonly execSql: ExecSql;
  readonly principalId: string;
  readonly principalType: ManagedPrincipalKind;
}): Promise<PrincipalPolicyCheckpoint | null> {
  const durable = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.principalType,
    input.principalId,
  );
  const cached = checkpointFromBundle(input.cachedBundle);

  if (!cached || durable?.version === cached.version) {
    return durable ?? cached;
  }

  return !durable || cached.version > durable.version ? cached : durable;
}
