import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  accessManifestCheckpointFromManifest,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { loadContainerRetirementCheck } from "../principalKeys/principalGrantRetirementPersistence";
import {
  accessManifestObjectKey,
  loadAccessManifestCheckpointRows,
  loadPrincipalPolicyCheckpointRows,
  principalPolicyKey,
  storedPrincipalPolicyPin,
  upsertAccessManifestCheckpointsInTransaction,
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
  stored: Awaited<ReturnType<typeof loadAccessManifestCheckpointRows>>,
): Promise<Map<string, AccessManifestCheckpoint>> {
  const pending = new Map<string, AccessManifestCheckpoint>();
  const assertNotRetired = await loadContainerRetirementCheck(
    tx,
    heads.map((head) => head.checkpoint),
  );
  for (const head of heads) {
    assertNotRetired(head.checkpoint);
    const key = accessManifestObjectKey(head.checkpoint);
    if (pending.has(key)) {
      throw new KeyingVerificationError(
        "equivocation",
        `locally acknowledged batch contains multiple heads for ${key}`,
      );
    }
    const row = stored.get(key);
    validateAcknowledgedHead(head, row ? { ...head.checkpoint, ...row } : null);
    pending.set(key, head.checkpoint);
  }
  return pending;
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
  const expectedAccess = input.expectedAccessManifestCheckpoints ?? [];
  const expectedPolicies = input.expectedPrincipalPolicyCheckpoints ?? [];
  const acknowledge = async (tx: ClientSQLiteTransactionScope) => {
    const stored = await loadAccessManifestCheckpointRows(tx, [
      ...input.heads.map((head) => head.checkpoint),
      ...expectedAccess,
    ]);
    for (const expected of expectedAccess) {
      const current = stored.get(accessManifestObjectKey(expected));
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
    const policies = await loadPrincipalPolicyCheckpointRows(
      tx,
      expectedPolicies,
    );
    for (const expected of expectedPolicies) {
      const current = storedPrincipalPolicyPin(
        policies.get(principalPolicyKey(expected)),
      );
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
    const pending = await validateAcknowledgedHeads(tx, input.heads, stored);
    await upsertAccessManifestCheckpointsInTransaction(
      tx,
      [...pending.values()],
      updatedAt,
    );
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
