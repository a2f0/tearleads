import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import {
  emptyVersionVector,
  getImportBlobMetadata,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@symcrypt/loro";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { documentKekTargetsFromContentKeyBundle } from "@symcrypt/validators/response";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
} from "../../data/documents/shared/projection";
import { assertDocumentManifestBundleConsistent } from "../../data/documents/shared/readers";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentSyncPlan,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { DocumentWriterProjectionAuthorization } from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { prepareDocumentOutgoingUpdates } from "./syncContentKeys";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import {
  type DocumentSyncTraceEmitter,
  traceCheckpointRegeneration,
  traceHealBlocked,
  traceHealPlanned,
  traceStaleBundle,
  traceStaleRead,
} from "./syncTrace";

/**
 * Builds the rotation baseline that anchors a stale-bundle heal: a full
 * history snapshot of the local document, re-encrypted under the fresh
 * content key so every current member (including post-rotation newcomers)
 * has an efficient current-epoch redirect. Predecessor KEKs remain the
 * correctness path when no covering baseline exists.
 */
async function buildStaleRecoveryBaselinePendingUpdate(
  buildRotationSnapshot: (() => Promise<Uint8Array | null>) | undefined,
): Promise<PendingUpdateRecord> {
  const snapshot = buildRotationSnapshot ? await buildRotationSnapshot() : null;
  if (!snapshot) {
    throw new Error(
      "Document content-key bundle is stale and no rotation snapshot is available to heal it",
    );
  }
  const metadata = getImportBlobMetadata(snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      "Document stale-bundle recovery requires a full-history rotation snapshot",
    );
  }
  const pendingFields = createPendingUpdateFields(
    snapshot,
    metadata.partialEndVersionVector,
  );
  if (!pendingFields) {
    throw new Error("Document stale-bundle recovery snapshot is empty");
  }

  return {
    id: crypto.randomUUID(),
    ...pendingFields,
  };
}

/**
 * Resolves the content material a sync plan encrypts and carries. A stale
 * bundle names predecessor KEK targets while the document's current targets
 * name successor epochs, so it splits by intent: a write-bearing pass heals
 * the document with a FRESH content key at the next epoch, anchored by a
 * covering rotation baseline, while a read-only pass keeps the stale pair and
 * unwraps it through predecessor KEKs so the server can settle a complete pull.
 */
/**
 * The manifest bundle a stale read-only plan must pair with: the one the
 * stale content-key bundle actually references. A stale bundle normally
 * still carries the current link-set manifest hash (KEK rotations do not
 * advance the document manifest), but the projection consistency check
 * defensively admits a bundle lagging the head as long as it appears in the
 * manifest history — pair with that historical bundle so the plan's own
 * identity checks hold.
 */
function staleBundleDocumentManifest(
  writerProjection: DocumentWriterProjectionResponse,
): DocumentCreateResponse["accessManifest"] {
  const { contentKeyBundle, documentManifest } = writerProjection;
  if (contentKeyBundle.linkSetManifestHash === documentManifest.manifestHash) {
    return documentManifest;
  }
  const historicalManifest = writerProjection.documentManifestHistory.find(
    (bundle) => bundle.manifestHash === contentKeyBundle.linkSetManifestHash,
  );
  if (!historicalManifest) {
    throw new Error(
      "Document stale bundle manifest is missing from the projection history",
    );
  }
  return historicalManifest;
}

/**
 * Settling a superseded checkpoint deletes its queue row, so the fresh
 * baseline must PROVABLY subsume it — assumed coverage would silently drop
 * any ops the checkpoint alone carried.
 */
function assertRecoveryBaselineCoversCheckpoints(
  recoveryBaseline: PendingUpdateRecord,
  checkpoints: readonly PendingUpdateRecord[],
): void {
  for (const checkpoint of checkpoints) {
    if (
      !satisfiesVersionVector(
        recoveryBaseline.partialEndVersionVector,
        checkpoint.partialEndVersionVector,
      )
    ) {
      throw new Error(
        "Document stale-bundle recovery snapshot does not cover a queued rotation checkpoint",
      );
    }
  }
}

interface ResolvedSyncPlanContentMaterial {
  contentKey: Uint8Array;
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
  healedStaleContentKeyBundle: boolean;
  heldBackPendingUpdateIds: readonly string[];
  pendingUpdates: readonly PendingUpdateRecord[];
  staleRecoveryBaselineUpdateId?: string;
}

async function resolveStaleHealMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>,
  pendingUpdates: readonly PendingUpdateRecord[],
): Promise<ResolvedSyncPlanContentMaterial> {
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  // A rotation checkpoint left in the queue by an interrupted earlier
  // recovery is superseded by the fresh covering baseline built below:
  // submitting it alongside would trip the server's covering-baseline gate,
  // and resubmitting it after the heal could become the latest baseline at
  // the healed epoch and mask the covering one. Hold it out of the request;
  // on heal success its id is reported settled (the committed baseline
  // subsumes its full-history content) so the queue row is removed.
  //
  // A heal whose OWN baseline does not cover the committed frontier is
  // rejected by that same gate and surfaces as a terminal queue failure.
  // This write-bearing pass does not pull first. A device missing committed
  // history can independently rematerialize it through predecessor KEKs on a
  // read-only pass, then retry with a covering snapshot. The coverage proof
  // prevents a partial local view from becoming the redirect baseline.
  const ordinaryPendingUpdates = pendingUpdates.filter(
    (update) => update.sourceVersionVector == null,
  );
  const heldBackCheckpoints = pendingUpdates.filter(
    (update) => update.sourceVersionVector != null,
  );
  const recoveryBaseline = await buildStaleRecoveryBaselinePendingUpdate(
    input.buildRotationSnapshot,
  );
  assertRecoveryBaselineCoversCheckpoints(
    recoveryBaseline,
    heldBackCheckpoints,
  );
  const staleEpoch = input.writerProjection.contentKeyBundle.contentKeyEpoch;
  const contentKeyBundle = await buildRotatedDocumentContentKeyBundle({
    containerKeksByEpochId,
    contentKey,
    writerProjection: input.writerProjection,
  });
  traceHealPlanned(input.onSyncTrace, {
    documentId: input.writerProjection.documentId,
    fromEpoch: staleEpoch,
    heldBack: heldBackCheckpoints.length,
    toEpoch: contentKeyBundle.contentKeyEpoch,
    updates: ordinaryPendingUpdates.length,
  });
  return {
    contentKey,
    contentKeyBundle,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    healedStaleContentKeyBundle: true,
    heldBackPendingUpdateIds: heldBackCheckpoints.map((update) => update.id),
    pendingUpdates: [recoveryBaseline, ...ordinaryPendingUpdates],
    staleRecoveryBaselineUpdateId: recoveryBaseline.id,
  };
}

/**
 * Reactive repair for a healthy-projection pass whose queued rotation
 * checkpoint the server rejected via the covering-baseline gate (a leftover
 * from an interrupted recovery, a heal whose ack was lost, or a lost heal
 * race). Queued checkpoints normally pass through untouched — reset and
 * rotation flows legitimately submit them — but a rejected one would strand
 * the whole queue, and committing it could shrink redirect coverage. Replace
 * the stale checkpoints with one freshly regenerated covering baseline and
 * settle them on success (coverage proven above).
 */
async function resolveCheckpointRegenerationMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  base: ResolvedSyncPlanContentMaterial,
  pendingUpdates: readonly PendingUpdateRecord[],
): Promise<ResolvedSyncPlanContentMaterial> {
  const ordinaryPendingUpdates = pendingUpdates.filter(
    (update) => update.sourceVersionVector == null,
  );
  const queuedCheckpoints = pendingUpdates.filter(
    (update) => update.sourceVersionVector != null,
  );
  const recoveryBaseline = await buildStaleRecoveryBaselinePendingUpdate(
    input.buildRotationSnapshot,
  );
  assertRecoveryBaselineCoversCheckpoints(recoveryBaseline, queuedCheckpoints);
  traceCheckpointRegeneration(input.onSyncTrace, {
    checkpoints: queuedCheckpoints.length,
    documentId: input.writerProjection.documentId,
    updates: ordinaryPendingUpdates.length,
  });
  return {
    ...base,
    heldBackPendingUpdateIds: queuedCheckpoints.map((update) => update.id),
    pendingUpdates: [recoveryBaseline, ...ordinaryPendingUpdates],
    staleRecoveryBaselineUpdateId: recoveryBaseline.id,
  };
}

async function resolveSyncPlanContentMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  collectedKeks: Awaited<
    ReturnType<typeof collectContainerKeksForDocumentSync>
  >,
): Promise<ResolvedSyncPlanContentMaterial> {
  const pendingUpdates = input.pendingUpdates ?? [];
  const staleContentKeyBundle =
    input.writerProjection.contentKeyBundleStale === true;

  if (staleContentKeyBundle && pendingUpdates.length > 0) {
    traceStaleBundle(input.onSyncTrace, {
      documentId: input.writerProjection.documentId,
      epoch: input.writerProjection.contentKeyBundle.contentKeyEpoch,
      pending: pendingUpdates.length,
    });
    return resolveStaleHealMaterial(
      input,
      collectedKeks.keksByEpochId,
      pendingUpdates,
    );
  }

  if (staleContentKeyBundle) {
    traceStaleRead(input.onSyncTrace, {
      documentId: input.writerProjection.documentId,
      epoch: input.writerProjection.contentKeyBundle.contentKeyEpoch,
    });
    // Current access includes every predecessor KEK. If damaged history makes
    // this old bundle unreachable, preserve the bridge-integrity failure: this
    // read actually needs that historical epoch and cannot safely continue.
    let staleContentKey: Uint8Array;
    try {
      staleContentKey = await unwrapDocumentContentKeyFromBundle(
        input.writerProjection.contentKeyBundle,
        collectedKeks.keksByEpochId,
        collectedKeks.predecessorFailuresByEpochId,
        collectedKeks.unattributedPredecessorFailuresByContainerId,
      );
    } catch (error) {
      if (error instanceof DocumentHistoryUnavailableError) {
        throw error;
      }
      // A stale bundle can predate the requester's current authorizing links.
      // Keep the read-only pass alive; served updates that need this absent key
      // remain undecryptable until a spanning member heals the bundle.
      staleContentKey = new Uint8Array();
    }
    return {
      contentKey: staleContentKey,
      contentKeyBundle: input.writerProjection.contentKeyBundle,
      documentKekTargets: documentKekTargetsFromContentKeyBundle(
        input.writerProjection.contentKeyBundle,
      ),
      documentManifest: staleBundleDocumentManifest(input.writerProjection),
      healedStaleContentKeyBundle: false,
      heldBackPendingUpdateIds: [],
      pendingUpdates,
    };
  }

  const normalMaterial: ResolvedSyncPlanContentMaterial = {
    contentKey: await unwrapDocumentContentKeyFromBundle(
      input.writerProjection.contentKeyBundle,
      collectedKeks.keksByEpochId,
      collectedKeks.predecessorFailuresByEpochId,
      collectedKeks.unattributedPredecessorFailuresByContainerId,
    ),
    contentKeyBundle: input.writerProjection.contentKeyBundle,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    healedStaleContentKeyBundle: false,
    heldBackPendingUpdateIds: [],
    pendingUpdates,
  };
  if (
    input.regenerateQueuedCheckpoints === true &&
    pendingUpdates.some((update) => update.sourceVersionVector != null)
  ) {
    return resolveCheckpointRegenerationMaterial(
      input,
      normalMaterial,
      pendingUpdates,
    );
  }

  return normalMaterial;
}

export async function buildMaterializedDocumentSyncPlan(
  input: {
    author: DocumentCreateAuthor;
    /**
     * Supplies a full-history Loro snapshot of the local document when a
     * stale content-key bundle must be healed, or when a leftover queued
     * rotation checkpoint must be regenerated as a covering baseline.
     * Without it those passes fail with a descriptive error instead.
     */
    buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
    execSql?: ExecSql | undefined;
    localVersionVector: string | null;
    minLsn?: string | undefined;
    /** Clipboard-safe trace sink (see syncTrace.ts); never receives content. */
    onSyncTrace?: DocumentSyncTraceEmitter | undefined;
    pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
    /**
     * Replace queued rotation checkpoints with a freshly regenerated covering
     * baseline instead of passing them through. Set by the sync loop after
     * the server rejected a pass via the covering-baseline gate.
     */
    regenerateQueuedCheckpoints?: boolean | undefined;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentSyncPlan> {
  // Reuse verification across consistency and unwrap passes; unwrap still
  // binds the key material independently.
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const principalPolicyCache = new Map<string, VerifiedPrincipalPolicy>();
  let writerAuthorization: DocumentWriterProjectionAuthorization | undefined;
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    allowStaleContentKeyBundle: true,
    execSql: input.execSql,
    onVerifiedAuthorization: (authorization) => {
      writerAuthorization = authorization;
    },
    principalPolicyCache,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const collectedKeks = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    principalPolicyCache,
    secretKey: input.targetSecretKey,
    verifiedByHash,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  const documentId = input.writerProjection.documentId;
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document sync manifest",
  });
  let material: ResolvedSyncPlanContentMaterial;
  try {
    material = await resolveSyncPlanContentMaterial(input, collectedKeks);
  } catch (error) {
    // Only a stale-bundle HEAL (write-bearing) or a checkpoint regeneration
    // counts as a blocked recovery; an ordinary pass or a stale READ failing
    // here must not read as one in a support report. Enumerated reason only;
    // unknown errors emit nothing (fail closed).
    if (
      (input.writerProjection.contentKeyBundleStale === true &&
        (input.pendingUpdates ?? []).length > 0) ||
      input.regenerateQueuedCheckpoints === true
    ) {
      traceHealBlocked(input.onSyncTrace, {
        documentId: input.writerProjection.documentId,
        error,
      });
    }
    throw error;
  }
  const {
    contentKey,
    contentKeyBundle,
    documentKekTargets,
    documentManifest,
    healedStaleContentKeyBundle,
    heldBackPendingUpdateIds,
    pendingUpdates,
    staleRecoveryBaselineUpdateId,
  } = material;
  const outgoingUpdates = await prepareDocumentOutgoingUpdates({
    contentKey,
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    documentId,
    organizationId: manifestIdentity.organizationId,
    pendingUpdates,
  });
  const basePlan = await buildDocumentSyncPlan({
    author: {
      ...input.author,
      organizationId: manifestIdentity.organizationId,
    },
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.writerProjection,
    ),
    contentKeyBundle,
    documentId,
    documentKekTargets,
    documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates,
    signedAt: input.signedAt,
  });
  const plan = writerAuthorization
    ? { ...basePlan, documentWriterAuthorization: writerAuthorization }
    : basePlan;

  return {
    contentKey,
    healedStaleContentKeyBundle,
    heldBackPendingUpdateIds,
    plan,
    ...(staleRecoveryBaselineUpdateId === undefined
      ? {}
      : { staleRecoveryBaselineUpdateId }),
  };
}
