import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type PrincipalPolicyAuthorization,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedPrincipalPolicy,
  verifyAccessManifestLocalCheckpoint,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
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
import { validateAccessManifestCheckpointEvidence } from "./keyingCheckpointEvidence";
import {
  accessManifestObjectKey,
  loadStoredAccessManifestCheckpoint,
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
  upsertAccessManifestCheckpointInTransaction,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "./keyingCheckpointPersistence";
import { assertContainerNotRetired } from "./principalGrantRetirementPersistence";
import {
  assertPrincipalPolicyBundleStoredInTransaction,
  writePrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

export interface AccessManifestCheckpointAdvance {
  readonly head: VerifiedAccessManifestCheckpointEvidence;
  readonly predecessors: readonly VerifiedAccessManifestCheckpointEvidence[];
}

interface KeyingCheckpointValidationInput {
  readonly access: readonly AccessManifestCheckpointAdvance[];
  readonly execSql: ExecSql;
  readonly policies: readonly PrincipalPolicyAuthorization[];
  readonly stillCurrent?: (() => boolean) | undefined;
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

  validateAccessManifestCheckpointEvidence({
    head: advance.head,
    predecessors,
    localCheckpoint,
  });

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
    await assertContainerNotRetired(tx, advance.head.checkpoint);
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

function extendsObservedPolicy(
  head: PrincipalPolicyAuthorization,
  candidate: PrincipalPolicyAuthorization,
): boolean {
  const history =
    "retainedHistory" in head ? head.retainedHistory : head.history;
  return (
    history?.some(
      ({ state }) =>
        state.principalType === candidate.principalType &&
        state.principalId === candidate.principalId &&
        state.version === candidate.version &&
        state.stateHash === candidate.stateHash,
    ) ?? false
  );
}

async function validatePolicyAdvances(
  tx: ClientSQLiteTransactionScope,
  policies: readonly PrincipalPolicyAuthorization[],
): Promise<Map<string, PrincipalPolicyAuthorization>> {
  const policiesByPrincipal = new Map<string, PrincipalPolicyAuthorization[]>();
  for (const policy of policies) {
    const key = principalPolicyKey(policy);
    const candidates = policiesByPrincipal.get(key) ?? [];
    candidates.push(policy);
    policiesByPrincipal.set(key, candidates);
  }

  const pending = new Map<string, PrincipalPolicyAuthorization>();
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
      if (!extendsObservedPolicy(head, candidate)) {
        throw new KeyingVerificationError(
          "stale_predecessor",
          `principal policy head does not extend observed state for ${key}`,
        );
      }
    }

    const localCheckpoint = await loadStoredPrincipalPolicyCheckpoint(tx, head);
    verifyPrincipalPolicyCheckpoint({
      chain:
        "retainedHistory" in head ? head.retainedHistory : (head.history ?? []),
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
  pending: ReadonlyMap<string, PrincipalPolicyAuthorization>,
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

async function ensureKeyingCheckpointValidationTables(
  input: KeyingCheckpointValidationInput,
): Promise<void> {
  await ensureSqlTables(
    input.execSql,
    input.policies.length > 0
      ? [...principalPolicyTables, ...keyingCheckpointTables]
      : keyingCheckpointTables,
  );
}

/** Re-checks verified candidates against durable pins without advancing them. */
export async function validateKeyingCheckpointsAtomically(
  input: KeyingCheckpointValidationInput,
): Promise<void> {
  await ensureKeyingCheckpointValidationTables(input);
  const validate = async (tx: ClientSQLiteTransactionScope) => {
    await validateAccessAdvances(tx, input.access);
    await validatePolicyAdvances(tx, input.policies);
  };
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  if (input.stillCurrent) {
    await runtime.guardedTransaction(validate, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(validate, { behavior: "immediate" });
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
  readonly policies: readonly PrincipalPolicyAuthorization[];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  await ensureKeyingCheckpointValidationTables(input);
  const updatedAt = new Date().toISOString();

  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const advance = async (tx: ClientSQLiteTransactionScope) => {
    const access = await validateAccessAdvances(tx, input.access);
    const policies = await validatePolicyAdvances(tx, input.policies);

    await writeAccessCheckpoints(tx, access, updatedAt);
    await writePolicyCheckpoints(tx, policies, updatedAt, input.organizationId);
    if (input.documentPurgeCheckpoint) {
      await storeDocumentPurgeCheckpointInTransaction(
        tx,
        input.documentPurgeCheckpoint,
        updatedAt,
      );
    }
  };
  if (input.stillCurrent) {
    await runtime.guardedTransaction(advance, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(advance, { behavior: "immediate" });
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
  readonly stillCurrent?: (() => boolean) | undefined;
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

  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const persist = async (tx: ClientSQLiteTransactionScope) => {
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
      const checkpoint = await loadStoredPrincipalPolicyCheckpoint(tx, policy);
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
  };
  if (input.stillCurrent) {
    await runtime.guardedTransaction(persist, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(persist, { behavior: "immediate" });
}
