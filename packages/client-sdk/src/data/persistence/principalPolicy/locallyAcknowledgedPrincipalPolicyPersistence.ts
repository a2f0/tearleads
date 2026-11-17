import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  assertPrincipalPolicyCheckpointShape,
  loadPrincipalPolicyCheckpointRows,
  principalPolicyKey,
  storedPrincipalPolicyPin,
  upsertPrincipalPolicyCheckpointsInTransaction,
} from "../keyingCheckpoints/keyingCheckpointPersistence";
import {
  type AcknowledgedPrincipalGrantRetirements,
  storePrincipalGrantRetirements,
} from "../principalContracts/principalGrantRetirementPersistence";
import {
  retainPrincipalPolicyBundleInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

function validateAcknowledgedPolicy(
  policy: VerifiedPrincipalPolicy,
  checkpoint: PrincipalPolicyCheckpoint | null,
  genesis: boolean,
): boolean {
  if (genesis) {
    if (policy.version !== 1 || policy.state.prevStateHash !== null) {
      throw new KeyingVerificationError(
        "invalid_shape",
        "registration policy must begin at version 1",
      );
    }
    if (checkpoint) assertPrincipalPolicyCheckpointShape(checkpoint, policy);
    // Adoption never advances a newer pin back to genesis. Equal versions
    // still pass through the normal fork check below.
    if (checkpoint && checkpoint.version > policy.version) return false;
  }
  verifyPrincipalPolicyCheckpoint({
    chain: policy.history ?? [],
    currentState: policy.state,
    localCheckpoint: checkpoint,
  });
  if (!checkpoint && policy.version !== 1) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "locally acknowledged principal policy does not begin at version 1",
    );
  }
  if (checkpoint && policy.version > checkpoint.version + 1) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "locally acknowledged principal policy does not directly extend the durable checkpoint",
    );
  }
  return true;
}

export interface LocallyAcknowledgedPrincipalPolicyBundle {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

/** An acknowledged batch; a false `stillCurrent` refuses its commit. */
export interface LocallyAcknowledgedPrincipalPolicyBundles {
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly organizationId?: string | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/**
 * Where a batch lands: `current` and `genesis` write heads, `history` only
 * retains them; `genesis` never moves a newer pin back to version 1.
 */
export interface LocallyAcknowledgedPrincipalPolicyStore {
  readonly retiredContainers?:
    | AcknowledgedPrincipalGrantRetirements
    | undefined;
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly organizationId?: string | undefined;
  readonly placement: "current" | "history" | "genesis";
}

/** Rejects a batch that repeats a principal or mismatches its verified policy. */
export async function assertLocallyAcknowledgedPrincipalPolicyBundles(
  entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[],
): Promise<void> {
  const seen = new Set<string>();
  for (const { policy } of entries) {
    const key = principalPolicyKey(policy);
    if (seen.has(key)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        `locally acknowledged policy batch repeats ${key}`,
      );
    }
    seen.add(key);
  }
  await Promise.all(
    entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
}

async function loadValidatedAcknowledgedCheckpoints(
  tx: ClientSQLiteTransactionScope,
  entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[],
  genesis: boolean,
): Promise<PrincipalPolicyCheckpoint[]> {
  const stored = await loadPrincipalPolicyCheckpointRows(
    tx,
    entries.map(({ policy }) => policy),
  );
  const checkpoints: PrincipalPolicyCheckpoint[] = [];
  for (const { policy } of entries) {
    const pin = storedPrincipalPolicyPin(
      stored.get(principalPolicyKey(policy)),
    );
    if (
      validateAcknowledgedPolicy(
        policy,
        pin ? { ...policy.checkpoint, ...pin } : null,
        genesis,
      )
    )
      checkpoints.push(policy.checkpoint);
  }
  return checkpoints;
}

export async function storeLocallyAcknowledgedPrincipalPolicyBundlesInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: LocallyAcknowledgedPrincipalPolicyStore,
  updatedAt: string,
): Promise<void> {
  const checkpoints = await loadValidatedAcknowledgedCheckpoints(
    tx,
    input.entries,
    input.placement === "genesis",
  );
  if (input.retiredContainers)
    await storePrincipalGrantRetirements(
      tx,
      input.retiredContainers,
      input.entries.map(({ policy }) => policy),
      input.organizationId,
    );
  for (const entry of input.entries) {
    if (input.placement !== "history") {
      await writePrincipalPolicyBundleInTransaction(
        tx,
        entry.bundle,
        updatedAt,
        input.organizationId,
      );
    } else {
      await retainPrincipalPolicyBundleInTransaction(
        tx,
        entry.bundle,
        updatedAt,
        input.organizationId,
      );
    }
  }
  await upsertPrincipalPolicyCheckpointsInTransaction(
    tx,
    checkpoints,
    updatedAt,
    input.organizationId,
  );
}
