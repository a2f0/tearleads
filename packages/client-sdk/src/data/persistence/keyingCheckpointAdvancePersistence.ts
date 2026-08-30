import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
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
  type DocumentPurgeCheckpoint,
  storeDocumentPurgeCheckpointInTransaction,
} from "./documentPurgeCheckpointPersistence";
import {
  accessManifestObjectKey,
  loadStoredAccessManifestCheckpoint,
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
  upsertAccessManifestCheckpointInTransaction,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "./keyingCheckpointPersistence";
import {
  assertPrincipalPolicyBundleStoredInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

export interface AccessManifestCheckpointAdvance {
  readonly head: VerifiedAccessManifestCheckpointEvidence;
  readonly predecessors: readonly VerifiedAccessManifestCheckpointEvidence[];
}

interface VerifiedPrincipalPolicyBundleEntry {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

interface PendingAccessCheckpoint {
  readonly checkpoint: AccessManifestCheckpoint;
}

function validateAccessAdvance(
  advance: AccessManifestCheckpointAdvance,
  localCheckpoint: AccessManifestCheckpoint | null,
): PendingAccessCheckpoint {
  const current = {
    ...advance.head.checkpoint,
    previousManifestHash: advance.head.manifest.previousManifestHash,
  };
  const predecessors = [...advance.predecessors].sort(
    (left, right) => left.checkpoint.epoch - right.checkpoint.epoch,
  );

  if (localCheckpoint && current.epoch <= localCheckpoint.epoch) {
    verifyAccessManifestLocalCheckpoint({
      current,
      localCheckpoint,
      checkpointPredecessors: undefined,
    });
  }

  const hashByEpoch = new Map<number, string>();
  for (const predecessor of predecessors) {
    if (
      accessManifestObjectKey(predecessor.checkpoint) !==
      accessManifestObjectKey(current)
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "access manifest checkpoint evidence belongs to another object",
      );
    }
    const previousHash = hashByEpoch.get(predecessor.checkpoint.epoch);
    if (previousHash && previousHash !== predecessor.manifestHash) {
      throw new KeyingVerificationError(
        "equivocation",
        `access manifest checkpoint evidence conflicts at epoch ${predecessor.checkpoint.epoch}`,
      );
    }
    hashByEpoch.set(predecessor.checkpoint.epoch, predecessor.manifestHash);
    if (
      predecessor.checkpoint.epoch === current.epoch &&
      predecessor.manifestHash !== current.manifestHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "access manifest checkpoint evidence conflicts with the declared head",
      );
    }
    if (
      localCheckpoint &&
      predecessor.checkpoint.epoch === localCheckpoint.epoch &&
      predecessor.manifestHash !== localCheckpoint.manifestHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "access manifest checkpoint evidence conflicts with the local checkpoint",
      );
    }
    if (predecessor.checkpoint.epoch > current.epoch) {
      throw new KeyingVerificationError(
        "stale_predecessor",
        "access manifest checkpoint evidence is newer than the declared head",
      );
    }
  }

  verifyAccessManifestLocalCheckpoint({
    current,
    localCheckpoint,
    checkpointPredecessors: predecessors.filter(
      (manifest) =>
        localCheckpoint !== null &&
        manifest.checkpoint.epoch > localCheckpoint.epoch &&
        manifest.checkpoint.epoch < current.epoch,
    ),
  });

  return {
    checkpoint: advance.head.checkpoint,
  };
}

async function validateAccessAdvances(
  tx: ClientSQLiteTransactionScope,
  advances: readonly AccessManifestCheckpointAdvance[],
): Promise<Map<string, PendingAccessCheckpoint>> {
  const pending = new Map<string, PendingAccessCheckpoint>();

  for (const advance of advances) {
    const key = accessManifestObjectKey(advance.head.checkpoint);
    if (pending.has(key)) {
      throw new KeyingVerificationError(
        "equivocation",
        `projection declares multiple access checkpoint heads for ${key}`,
      );
    }
    const localCheckpoint = await loadStoredAccessManifestCheckpoint(
      tx,
      advance.head.checkpoint,
    );
    pending.set(key, validateAccessAdvance(advance, localCheckpoint));
  }

  return pending;
}

async function validatePolicyAdvances(
  tx: ClientSQLiteTransactionScope,
  policies: readonly AnyVerifiedPrincipalPolicy[],
): Promise<Map<string, AnyVerifiedPrincipalPolicy>> {
  const policiesByPrincipal = new Map<string, AnyVerifiedPrincipalPolicy[]>();
  for (const policy of policies) {
    const key = principalPolicyKey(policy);
    const candidates = policiesByPrincipal.get(key) ?? [];
    candidates.push(policy);
    policiesByPrincipal.set(key, candidates);
  }

  const pending = new Map<string, AnyVerifiedPrincipalPolicy>();
  for (const key of [...policiesByPrincipal.keys()].sort()) {
    const candidates = policiesByPrincipal.get(key) ?? [];
    const maxVersion = Math.max(...candidates.map((policy) => policy.version));
    const heads = candidates.filter((policy) => policy.version === maxVersion);
    const head = heads[0];
    if (!head) {
      continue;
    }
    if (heads.some((candidate) => candidate.stateHash !== head.stateHash)) {
      throw new KeyingVerificationError(
        "equivocation",
        `principal policy declares conflicting heads for ${key}`,
      );
    }
    for (const candidate of candidates) {
      if (candidate.version === head.version) {
        continue;
      }
      const extendsCandidate = head.history?.some(
        (entry) =>
          entry.state.principalType === candidate.principalType &&
          entry.state.principalId === candidate.principalId &&
          entry.state.version === candidate.version &&
          entry.state.stateHash === candidate.stateHash,
      );
      if (!extendsCandidate) {
        throw new KeyingVerificationError(
          "stale_predecessor",
          `principal policy head does not extend observed state for ${key}`,
        );
      }
    }

    const localCheckpoint = await loadStoredPrincipalPolicyCheckpoint(tx, head);
    verifyPrincipalPolicyCheckpoint({
      chain: head.history ?? [],
      currentState: head.state,
      localCheckpoint,
    });
    pending.set(key, head);
  }

  return pending;
}

async function writeAccessCheckpoints(
  tx: ClientSQLiteTransactionScope,
  pending: ReadonlyMap<string, PendingAccessCheckpoint>,
  updatedAt: string,
): Promise<void> {
  for (const { checkpoint } of pending.values()) {
    await upsertAccessManifestCheckpointInTransaction(
      tx,
      checkpoint,
      updatedAt,
    );
  }
}

async function writePolicyCheckpoints(
  tx: ClientSQLiteTransactionScope,
  pending: ReadonlyMap<string, AnyVerifiedPrincipalPolicy>,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  for (const policy of pending.values()) {
    await upsertPrincipalPolicyCheckpointInTransaction(
      tx,
      policy.checkpoint,
      updatedAt,
      organizationId,
    );
  }
}

/**
 * Re-check every verified projection candidate against the latest durable pins
 * and advance the complete batch atomically. Signature verification and remote
 * fetching happen before this short transaction; only checkpoint comparison
 * and persistence are serialized here.
 */
export async function advanceKeyingCheckpointsAtomically(input: {
  readonly access: readonly AccessManifestCheckpointAdvance[];
  readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly policies: readonly AnyVerifiedPrincipalPolicy[];
}): Promise<void> {
  await ensureSqlTables(
    input.execSql,
    input.policies.length > 0
      ? [...principalPolicyTables, ...keyingCheckpointTables]
      : keyingCheckpointTables,
  );
  const updatedAt = new Date().toISOString();

  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      const access = await validateAccessAdvances(tx, input.access);
      const policies = await validatePolicyAdvances(tx, input.policies);

      await writeAccessCheckpoints(tx, access, updatedAt);
      await writePolicyCheckpoints(
        tx,
        policies,
        updatedAt,
        input.organizationId,
      );
      if (input.documentPurgeCheckpoint) {
        await storeDocumentPurgeCheckpointInTransaction(
          tx,
          input.documentPurgeCheckpoint,
          updatedAt,
        );
      }
    },
    { behavior: "immediate" },
  );
}

/**
 * Persists each verified full policy bundle together with its durable head.
 * This prevents a crash or bundle-write failure from leaving a checkpoint
 * without the exact same-head payload and member-envelope evidence.
 */
export async function persistVerifiedPrincipalPolicyBundlesAtomically(input: {
  readonly entries: readonly VerifiedPrincipalPolicyBundleEntry[];
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const key = principalPolicyKey(entry.policy);
    if (seen.has(key)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        `verified policy bundle batch repeats ${key}`,
      );
    }
    seen.add(key);
  }
  await Promise.all(
    input.entries.map((entry) => assertBundleMatchesVerifiedPolicy(entry)),
  );
  await ensureSqlTables(input.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);

  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      const policies = await validatePolicyAdvances(
        tx,
        input.entries.map((entry) => entry.policy),
      );
      for (const entry of input.entries) {
        await writePrincipalPolicyBundleInTransaction(
          tx,
          entry.bundle,
          input.updatedAt,
          input.organizationId,
        );
        await assertPrincipalPolicyBundleStoredInTransaction(tx, entry.bundle);
      }
      await writePolicyCheckpoints(
        tx,
        policies,
        input.updatedAt,
        input.organizationId,
      );
      for (const policy of policies.values()) {
        const checkpoint = await loadStoredPrincipalPolicyCheckpoint(
          tx,
          policy,
        );
        if (
          !checkpoint ||
          checkpoint.version !== policy.version ||
          checkpoint.stateHash !== policy.stateHash
        ) {
          throw new Error(
            "Verified principal policy checkpoint was not persisted",
          );
        }
      }
    },
    { behavior: "immediate" },
  );
}
