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
import { keyingCheckpointTables } from "../../sqlite/schema/keyingCheckpointSchema";
import { principalPolicyTables } from "../../sqlite/schema/principalPolicySchema";
import { verifiedManifestBundleTables } from "../../sqlite/schema/verifiedManifestBundleSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { loadContainerRetirementCheck } from "../principalContracts/principalGrantRetirementPersistence";
import {
  type VerifiedManifestBundle,
  type VerifiedManifestBundleRow,
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

/** A verified batch of checkpoint candidates; the repository supplies the executor. */
export interface KeyingCheckpointBatch {
  readonly access: readonly AccessManifestCheckpointAdvance[];
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

export interface KeyingCheckpointAdvanceBatch extends KeyingCheckpointBatch {
  readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
  readonly organizationId?: string | undefined;
}

interface PendingAccessCheckpoint {
  readonly changed: boolean;
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
    changed:
      localCheckpoint?.epoch !== current.epoch ||
      localCheckpoint.manifestHash !== current.manifestHash,
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

/** The newest candidate, which must be unique and extend every other one. */
function selectPrincipalPolicyHead(
  key: string,
  candidates: readonly CheckpointPolicy[],
): CheckpointPolicy | null {
  const maxVersion = Math.max(...candidates.map((policy) => policy.version));
  const heads = candidates.filter((policy) => policy.version === maxVersion);
  const head = heads[0];
  if (!head) {
    return null;
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
  return head;
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
    const head = selectPrincipalPolicyHead(
      key,
      policiesByPrincipal.get(key) ?? [],
    );
    if (!head) {
      continue;
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
    [...pending.values()]
      .filter(({ changed }) => changed)
      .map(({ checkpoint }) => checkpoint),
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

/** Every table a batch touches, ensured before its transaction begins. */
export function keyingCheckpointBatchTables(
  batch: KeyingCheckpointBatch,
  bundleRows: readonly VerifiedManifestBundleRow[],
) {
  return [
    ...(batch.policies.length > 0 ||
    (batch.authorizationPolicies?.length ?? 0) > 0
      ? principalPolicyTables
      : []),
    ...keyingCheckpointTables,
    ...(bundleRows.length > 0 ? verifiedManifestBundleTables : []),
  ];
}

/**
 * Re-checks verified candidates against durable pins without advancing them.
 * Only the verified bundles' citation rows are written.
 */
export async function validateKeyingCheckpointsInTransaction(
  tx: ClientSQLiteTransactionScope,
  batch: KeyingCheckpointBatch,
  bundleRows: readonly VerifiedManifestBundleRow[],
  verifiedAt: string,
): Promise<void> {
  await validateAccessAdvances(tx, batch.access);
  await validatePrincipalPolicyCheckpointAdvances(tx, batch.policies);
  await validatePrincipalAuthorizationCheckpoints(
    tx,
    batch.authorizationPolicies ?? [],
  );
  await writeVerifiedManifestBundlesInTransaction(tx, bundleRows, verifiedAt);
}

/**
 * Re-check every verified projection candidate against the latest durable pins
 * and advance the complete batch. Signature verification and remote fetching
 * happen before the short transaction this runs in; only checkpoint comparison
 * and persistence, with the batch's verified bundles, are serialized here.
 */
export async function advanceKeyingCheckpointsInTransaction(
  tx: ClientSQLiteTransactionScope,
  batch: KeyingCheckpointAdvanceBatch,
  bundleRows: readonly VerifiedManifestBundleRow[],
  updatedAt: string,
): Promise<void> {
  const access = await validateAccessAdvances(tx, batch.access);
  const policies = await validatePrincipalPolicyCheckpointAdvances(
    tx,
    batch.policies,
  );
  await validatePrincipalAuthorizationCheckpoints(
    tx,
    batch.authorizationPolicies ?? [],
  );

  await writeAccessCheckpoints(tx, access, updatedAt);
  await writePrincipalPolicyCheckpoints(
    tx,
    policies,
    updatedAt,
    batch.organizationId,
  );
  if (batch.documentPurgeCheckpoint) {
    await storeDocumentPurgeCheckpointInTransaction(
      tx,
      batch.documentPurgeCheckpoint,
      updatedAt,
    );
  }
  await writeVerifiedManifestBundlesInTransaction(tx, bundleRows, updatedAt);
}
