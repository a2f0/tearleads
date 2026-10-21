import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  accessManifestCheckpointFromManifest,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import { keyingCheckpointTables } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { assertContainerNotRetired } from "../principalKeys/principalGrantRetirementPersistence";
import {
  accessManifestObjectKey,
  loadStoredAccessManifestCheckpoint,
  loadStoredPrincipalPolicyCheckpoint,
  upsertAccessManifestCheckpointInTransaction,
} from "./keyingCheckpointPersistence";

export interface LocallyAcknowledgedAccessManifestHead {
  readonly checkpoint: AccessManifestCheckpoint;
  readonly previousManifestHash: string | null;
}

export function locallyAuthoredAccessManifestHead(plan: {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): LocallyAcknowledgedAccessManifestHead {
  return {
    checkpoint: accessManifestCheckpointFromManifest({
      manifest: plan.manifest,
      manifestHash: plan.manifestHash,
    }),
    previousManifestHash: plan.manifest.previousManifestHash,
  };
}

function validateAcknowledgedHead(
  head: LocallyAcknowledgedAccessManifestHead,
  localCheckpoint: AccessManifestCheckpoint | null,
): void {
  if (!localCheckpoint) {
    if (head.checkpoint.epoch !== 1 || head.previousManifestHash !== null) {
      throw new KeyingVerificationError(
        "stale_predecessor",
        "locally acknowledged access manifest does not begin at epoch 1",
      );
    }
    return;
  }

  verifyAccessManifestLocalCheckpoint({
    checkpointPredecessors: [],
    current: {
      ...head.checkpoint,
      previousManifestHash: head.previousManifestHash,
    },
    localCheckpoint,
  });
}

async function validateAcknowledgedHeads(
  tx: ClientSQLiteTransactionScope,
  heads: readonly LocallyAcknowledgedAccessManifestHead[],
): Promise<Map<string, AccessManifestCheckpoint>> {
  const pending = new Map<string, AccessManifestCheckpoint>();
  for (const head of heads) {
    await assertContainerNotRetired(tx, head.checkpoint);
    const key = accessManifestObjectKey(head.checkpoint);
    if (pending.has(key)) {
      throw new KeyingVerificationError(
        "equivocation",
        `locally acknowledged batch contains multiple heads for ${key}`,
      );
    }
    validateAcknowledgedHead(
      head,
      await loadStoredAccessManifestCheckpoint(tx, head.checkpoint),
    );
    pending.set(key, head.checkpoint);
  }
  return pending;
}

async function writeAcknowledgedHeads(
  tx: ClientSQLiteTransactionScope,
  pending: ReadonlyMap<string, AccessManifestCheckpoint>,
  updatedAt: string,
): Promise<void> {
  for (const checkpoint of pending.values()) {
    await upsertAccessManifestCheckpointInTransaction(
      tx,
      checkpoint,
      updatedAt,
    );
  }
}

/**
 * Commits only heads authored and signed by this client after an exact remote
 * acknowledgement check. Every non-initial head must directly extend the
 * latest durable pin; arbitrary remote projections must use the verified
 * projection checkpoint path instead.
 */
export async function advanceLocallyAcknowledgedAccessManifestHeadsAtomically(input: {
  readonly execSql: ExecSql;
  readonly heads: readonly LocallyAcknowledgedAccessManifestHead[];
  /** Optional optimistic read dependencies, checked inside the write transaction. */
  readonly expectedAccessManifestCheckpoints?: readonly AccessManifestCheckpoint[];
  readonly expectedPrincipalPolicyCheckpoints?: readonly PrincipalPolicyCheckpoint[];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  await ensureSqlTables(input.execSql, keyingCheckpointTables);
  const updatedAt = new Date().toISOString();
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const acknowledge = async (tx: ClientSQLiteTransactionScope) => {
    for (const expected of input.expectedAccessManifestCheckpoints ?? []) {
      const current = await loadStoredAccessManifestCheckpoint(tx, expected);
      if (
        current?.epoch !== expected.epoch ||
        current.manifestHash !== expected.manifestHash
      ) {
        throw new KeyingVerificationError(
          "stale_predecessor",
          "A re-citation container checkpoint changed before acknowledgement",
        );
      }
    }
    for (const expected of input.expectedPrincipalPolicyCheckpoints ?? []) {
      const current = await loadStoredPrincipalPolicyCheckpoint(tx, expected);
      if (
        current?.version !== expected.version ||
        current.stateHash !== expected.stateHash
      ) {
        throw new KeyingVerificationError(
          "stale_predecessor",
          "A re-citation principal policy checkpoint changed before acknowledgement",
        );
      }
    }
    const pending = await validateAcknowledgedHeads(tx, input.heads);
    await writeAcknowledgedHeads(tx, pending, updatedAt);
  };
  if (input.stillCurrent) {
    return (
      await runtime.guardedTransaction(acknowledge, input.stillCurrent, {
        behavior: "immediate",
      })
    ).committed;
  }
  await runtime.transaction(acknowledge, { behavior: "immediate" });
  return true;
}
