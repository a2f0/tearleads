import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  accessManifestCheckpointFromManifest,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedPrincipalPolicy,
  verifyAccessManifestLocalCheckpoint,
  verifyPrincipalPolicyCheckpoint,
} from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import {
  keyingCheckpointTables,
  principalPolicyTables,
} from "../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import {
  accessManifestObjectKey,
  loadStoredAccessManifestCheckpoint,
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
  upsertAccessManifestCheckpointInTransaction,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "./keyingCheckpointPersistence";
import {
  retainPrincipalPolicyBundleInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

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
}): Promise<void> {
  await ensureSqlTables(input.execSql, keyingCheckpointTables);
  const updatedAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      const pending = await validateAcknowledgedHeads(tx, input.heads);
      await writeAcknowledgedHeads(tx, pending, updatedAt);
    },
    { behavior: "immediate" },
  );
}

function validateAcknowledgedPolicy(
  policy: VerifiedPrincipalPolicy,
  checkpoint: PrincipalPolicyCheckpoint | null,
): void {
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
}

interface LocallyAcknowledgedPrincipalPolicyBundle {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

function assertUniqueAcknowledgedPolicies(
  entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[],
): void {
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
}

async function storeAcknowledgedPrincipalPolicyBundles(input: {
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly placement: "current" | "history";
  readonly updatedAt: string;
}): Promise<void> {
  assertUniqueAcknowledgedPolicies(input.entries);
  await Promise.all(
    input.entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
  await ensureSqlTables(input.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      for (const { policy } of input.entries) {
        validateAcknowledgedPolicy(
          policy,
          await loadStoredPrincipalPolicyCheckpoint(tx, policy),
        );
      }
      for (const entry of input.entries) {
        if (input.placement === "current") {
          await writePrincipalPolicyBundleInTransaction(
            tx,
            entry.bundle,
            input.updatedAt,
          );
        } else {
          await retainPrincipalPolicyBundleInTransaction(
            tx,
            entry.bundle,
            input.updatedAt,
          );
        }
      }
      for (const { policy } of input.entries) {
        await upsertPrincipalPolicyCheckpointInTransaction(
          tx,
          policy.checkpoint,
          input.updatedAt,
        );
      }
    },
    { behavior: "immediate" },
  );
}

/** Atomically pins and caches exact full policy bundles acknowledged by the API. */
export function persistLocallyAcknowledgedPrincipalPolicyBundles(input: {
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly updatedAt: string;
}): Promise<void> {
  return storeAcknowledgedPrincipalPolicyBundles({
    ...input,
    placement: "current",
  });
}

export function persistLocallyAcknowledgedPrincipalPolicyBundle(
  input: LocallyAcknowledgedPrincipalPolicyBundle & {
    readonly execSql: ExecSql;
    readonly updatedAt: string;
  },
): Promise<void> {
  return persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [input],
    execSql: input.execSql,
    updatedAt: input.updatedAt,
  });
}

export function retainLocallyAcknowledgedPrincipalPolicyBundles(input: {
  readonly entries: readonly LocallyAcknowledgedPrincipalPolicyBundle[];
  readonly execSql: ExecSql;
  readonly updatedAt: string;
}): Promise<void> {
  return storeAcknowledgedPrincipalPolicyBundles({
    ...input,
    placement: "history",
  });
}
