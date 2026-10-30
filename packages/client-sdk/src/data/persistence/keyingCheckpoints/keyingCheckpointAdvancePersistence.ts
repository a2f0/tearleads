import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedPrincipalPolicyCurrent,
  type VerifiedPrincipalPolicySelection,
  verifyAccessManifestLocalCheckpoint,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import {
  keyingCheckpointTables,
  principalPolicyTables,
} from "../../sqlite/schema";
import { verifiedManifestBundleTables } from "../../sqlite/schema/verifiedManifestBundleSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { loadContainerRetirementCheck } from "../principalKeys/principalGrantRetirementPersistence";
import {
  type VerifiedManifestBundle,
  type VerifiedManifestBundleRow,
  verifiedManifestBundleRows,
  writeVerifiedManifestBundlesInTransaction,
} from "../verifiedManifestBundlePersistence";
import {
  type DocumentPurgeCheckpoint,
  storeDocumentPurgeCheckpointInTransaction,
} from "./documentPurgeCheckpointPersistence";
import { validateAccessManifestCheckpointEvidence } from "./keyingCheckpointEvidence";
import {
  accessManifestObjectKey,
  loadAccessManifestCheckpointRows,
  loadStoredPrincipalPolicyCheckpoints,
  principalPolicyKey,
  upsertAccessManifestCheckpointsInTransaction,
  upsertPrincipalPolicyCheckpointsInTransaction,
} from "./keyingCheckpointPersistence";
import { validatePrincipalAuthorizationCheckpoints } from "./principalAuthorizationCheckpoints";

export interface AccessManifestCheckpointAdvance {
  readonly head: VerifiedAccessManifestCheckpointEvidence;
  readonly predecessors: readonly VerifiedAccessManifestCheckpointEvidence[];
}

type CheckpointPolicy =
  | AnyVerifiedPrincipalPolicy
  | VerifiedPrincipalPolicyCurrent;

interface KeyingCheckpointValidationInput {
  readonly access: readonly AccessManifestCheckpointAdvance[];
  readonly execSql: ExecSql;
  readonly policies: readonly CheckpointPolicy[];
  readonly authorizationPolicies?:
    | readonly VerifiedPrincipalPolicySelection[]
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  /**
   * Bundles this projection verified. They are stored for later citation in
   * the same transaction, so they commit only with the batch they verified.
   */
  readonly verifiedBundles?: readonly VerifiedManifestBundle[] | undefined;
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
  if (advances.length === 0) return pending;
  // Set reads first; the checks then replay in order, so the same advance
  // fails first with the same error.
  const heads = advances.map((advance) => advance.head.checkpoint);
  const assertNotRetired = await loadContainerRetirementCheck(tx, heads);
  const stored = await loadAccessManifestCheckpointRows(tx, heads);

  for (const advance of advances) {
    assertNotRetired(advance.head.checkpoint);
    const key = accessManifestObjectKey(advance.head.checkpoint);
    if (pending.has(key)) {
      throw new KeyingVerificationError(
        "equivocation",
        `projection declares multiple access checkpoint heads for ${key}`,
      );
    }
    const row = stored.get(key);
    const localCheckpoint = row ? { ...advance.head.checkpoint, ...row } : null;
    pending.set(key, validateAccessAdvance(advance, localCheckpoint));
  }

  return pending;
}

function extendsObservedPolicy(
  head: CheckpointPolicy,
  candidate: CheckpointPolicy,
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

/**
 * Checks, inside the caller's transaction, that each principal's newest policy
 * extends every other candidate and its durable checkpoint. Returns the heads
 * to pin, keyed by principal.
 */
export async function validatePrincipalPolicyCheckpointAdvances(
  tx: ClientSQLiteTransactionScope,
  policies: readonly CheckpointPolicy[],
): Promise<Map<string, CheckpointPolicy>> {
  const policiesByPrincipal = new Map<string, CheckpointPolicy[]>();
  for (const policy of policies) {
    const key = principalPolicyKey(policy);
    const candidates = policiesByPrincipal.get(key) ?? [];
    candidates.push(policy);
    policiesByPrincipal.set(key, candidates);
  }

  const pending = new Map<string, CheckpointPolicy>();
  const stored = await loadStoredPrincipalPolicyCheckpoints(tx, policies);
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

    const localCheckpoint = stored.get(key) ?? null;
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
  await upsertAccessManifestCheckpointsInTransaction(
    tx,
    [...pending.values()].map(({ checkpoint }) => checkpoint),
    updatedAt,
  );
}

/** Pins the heads `validatePrincipalPolicyCheckpointAdvances` returned. */
export async function writePrincipalPolicyCheckpoints(
  tx: ClientSQLiteTransactionScope,
  pending: ReadonlyMap<string, CheckpointPolicy>,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  await upsertPrincipalPolicyCheckpointsInTransaction(
    tx,
    [...pending.values()].map((policy) => policy.checkpoint),
    updatedAt,
    organizationId,
  );
}

/**
 * Digests the verified bundles and ensures every table the batch touches,
 * all before its transaction begins.
 */
async function prepareKeyingCheckpointBatch(
  input: KeyingCheckpointValidationInput,
): Promise<VerifiedManifestBundleRow[]> {
  const bundleRows = await verifiedManifestBundleRows(
    input.verifiedBundles ?? [],
  );
  await ensureSqlTables(input.execSql, [
    ...(input.policies.length > 0 ||
    (input.authorizationPolicies?.length ?? 0) > 0
      ? principalPolicyTables
      : []),
    ...keyingCheckpointTables,
    ...(bundleRows.length > 0 ? verifiedManifestBundleTables : []),
  ]);
  return bundleRows;
}

/**
 * Re-checks verified candidates against durable pins without advancing them.
 * Only the verified bundles' citation rows are written.
 */
export async function validateKeyingCheckpointsAtomically(
  input: KeyingCheckpointValidationInput,
): Promise<void> {
  const bundleRows = await prepareKeyingCheckpointBatch(input);
  const verifiedAt = new Date().toISOString();
  const validate = async (tx: ClientSQLiteTransactionScope) => {
    await validateAccessAdvances(tx, input.access);
    await validatePrincipalPolicyCheckpointAdvances(tx, input.policies);
    await validatePrincipalAuthorizationCheckpoints(
      tx,
      input.authorizationPolicies ?? [],
    );
    await writeVerifiedManifestBundlesInTransaction(tx, bundleRows, verifiedAt);
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
 * and persistence, with the batch's verified bundles, are serialized here.
 */
export async function advanceKeyingCheckpointsAtomically(
  input: KeyingCheckpointValidationInput & {
    readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
    readonly organizationId?: string | undefined;
  },
): Promise<void> {
  const bundleRows = await prepareKeyingCheckpointBatch(input);
  const updatedAt = new Date().toISOString();

  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const advance = async (tx: ClientSQLiteTransactionScope) => {
    const access = await validateAccessAdvances(tx, input.access);
    const policies = await validatePrincipalPolicyCheckpointAdvances(
      tx,
      input.policies,
    );
    await validatePrincipalAuthorizationCheckpoints(
      tx,
      input.authorizationPolicies ?? [],
    );

    await writeAccessCheckpoints(tx, access, updatedAt);
    await writePrincipalPolicyCheckpoints(
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
    await writeVerifiedManifestBundlesInTransaction(tx, bundleRows, updatedAt);
  };
  if (input.stillCurrent) {
    await runtime.guardedTransaction(advance, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(advance, { behavior: "immediate" });
}
