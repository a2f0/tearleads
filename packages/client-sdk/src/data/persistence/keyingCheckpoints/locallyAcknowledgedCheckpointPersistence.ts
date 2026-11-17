import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  accessManifestCheckpointFromManifest,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  verifyAccessManifestLocalCheckpoint,
} from "@tearleads/crypto";
import type { ServedAccessManifestBundleWireResponse } from "@tearleads/validators/util";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type AuthoredManifestBundle,
  acknowledgedAuthoredBundle,
} from "../verifiedCitations/authoredBundleCitation";

export type { AuthoredManifestBundle } from "../verifiedCitations/authoredBundleCitation";

import { loadContainerRetirementCheck } from "../principalContracts/principalGrantRetirementPersistence";
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
  /**
   * The head's bundle as a projection serves it, when the acknowledgement's
   * digest matched the plan; stored for citation with the checkpoint.
   */
  readonly servedBundle?: ServedAccessManifestBundleWireResponse | null;
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

/**
 * An authored head with its served bundle for citation, when the
 * acknowledgement's digest names exactly the bundle the plan builds.
 */
export async function locallyAcknowledgedAuthoredHead(
  plan: AuthoredManifestBundle,
  bundleDigest: string,
): Promise<LocallyAcknowledgedAccessManifestHead> {
  return {
    ...locallyAuthoredAccessManifestHead(plan),
    servedBundle: await acknowledgedAuthoredBundle(plan, bundleDigest),
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

/** Heads this client authored, with the pins its plan read. */
export interface LocallyAcknowledgedAdvance {
  readonly heads: readonly LocallyAcknowledgedAccessManifestHead[];
  /** Optional optimistic read dependencies, checked inside the write transaction. */
  readonly expectedAccessManifestCheckpoints?: readonly AccessManifestCheckpoint[];
  readonly expectedPrincipalPolicyCheckpoints?: readonly PrincipalPolicyCheckpoint[];
  readonly stillCurrent?: (() => boolean) | undefined;
}

/**
 * Commits only heads authored and signed by this client after an exact remote
 * acknowledgement check. Every non-initial head must directly extend the
 * latest durable pin; arbitrary remote projections must use the verified
 * projection checkpoint path instead.
 */
export async function acknowledgeLocallyAuthoredHeadsInTransaction(
  tx: ClientSQLiteTransactionScope,
  advance: LocallyAcknowledgedAdvance,
  updatedAt: string,
): Promise<void> {
  const expectedAccess = advance.expectedAccessManifestCheckpoints ?? [];
  const expectedPolicies = advance.expectedPrincipalPolicyCheckpoints ?? [];
  const stored = await loadAccessManifestCheckpointRows(tx, [
    ...advance.heads.map((head) => head.checkpoint),
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
  const pending = await validateAcknowledgedHeads(tx, advance.heads, stored);
  await upsertAccessManifestCheckpointsInTransaction(
    tx,
    [...pending.values()],
    updatedAt,
  );
}
