import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  signWriteHeader,
  type UnsignedWriteHeader,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  emptyVersionVector,
  getImportBlobMetadata,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  documentKekTargetsFromContentKeyBundle,
  isAccessManifestBundleWireResponse,
  isDocumentContentKeyBundleResponse,
  isDocumentKekTargetsResponse,
} from "@tearleads/validators/response";
import {
  createPendingUpdateFields,
  isDocumentUpdateCreatedEvent,
} from "../../data/documentSync";
import {
  decryptDocumentSyncUpdatesByEpoch,
  encryptDocumentPendingUpdate,
  importDocumentContentKeyMaterial,
} from "../../data/documents/shared/crypto";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
  unwrapDocumentContentKeyFromBundle,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  normalizeDocumentKekTargetResponse,
  readWriteHeader,
  serializeCanonical,
  sortDocumentTargets,
  targetEnvelopeReference,
} from "../../data/documents/shared/readers";
import {
  isRetryableDocumentSyncConflict,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "../../data/documents/shared/responses";
import type {
  BuildDocumentSyncPlanInput,
  DocumentCreateAuthor,
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncPreparedUpdate,
  DocumentWriterPublicKeyResolver,
  MaterializedDocumentSyncPlan,
  PersistedDocumentSyncState,
  ProjectionVerificationOptions,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  handleUpstreamDeletedDocumentSyncFailure,
  projectionIntegrityErrorCode,
  type RemoteDocumentDeletionHandler,
  resolveSyncAttemptWriterProjection,
  retrySyncPlanOrAbandon,
  submitDocumentSyncAttemptIfAllowed,
  type TerminalSubmitFailureHandler,
} from "./syncFailures";
import {
  type RekeyPendingUpdate,
  rekeyAndReportUnsettledRecoveryPendingUpdates,
  settledPendingUpdateIdsFromSync,
} from "./syncRecoveryRekey";
import {
  type DocumentSyncTraceEmitter,
  traceCheckpointRegeneration,
  traceHealBlocked,
  traceHealed,
  traceHealPlanned,
  traceStaleBundle,
  traceStaleRead,
  traceSubmitFailed,
} from "./syncTrace";

export function hasDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  documentId: string | null | undefined,
): boolean {
  if (!documentId) {
    return false;
  }

  return events.some(
    (event) =>
      isDocumentUpdateCreatedEvent(event) && event.documentId === documentId,
  );
}

async function prepareDocumentOutgoingUpdates(input: {
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Promise<DocumentSyncPreparedUpdate[]> {
  if (input.pendingUpdates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

  return Promise.all(
    input.pendingUpdates.map(async (update) => {
      const encrypted = await encryptDocumentPendingUpdate({
        contentKeyMaterial,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });

      return {
        contentRecordId: encrypted.contentRecordId,
        encryptedData: encrypted.encryptedData,
        id: update.id,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        metadataHash: encrypted.metadataHash,
        ciphertextHash: encrypted.ciphertextHash,
        ...(update.sourceVersionVector
          ? {
              checkpointKind: "rotate_baseline" as const,
              checkpointPayloadKind: "full_history_snapshot" as const,
              sourceVersionVector: update.sourceVersionVector,
            }
          : {}),
      };
    }),
  );
}

function syncResponseContentKeyBundlesByEpoch(
  response: DocumentSyncResponse,
): ReadonlyMap<number, DocumentSyncResponse["contentKeyBundle"]> {
  const byEpoch = new Map<number, DocumentSyncResponse["contentKeyBundle"]>();

  for (const bundle of [
    response.contentKeyBundle,
    ...response.contentKeyBundles,
  ]) {
    const existing = byEpoch.get(bundle.contentKeyEpoch);
    if (!existing) {
      byEpoch.set(bundle.contentKeyEpoch, bundle);
      continue;
    }
    if (
      serializeCanonical(existing, "content-key bundle") !==
      serializeCanonical(bundle, "content-key bundle")
    ) {
      throw new Error("Document sync response content-key bundle conflict");
    }
  }

  return byEpoch;
}

async function unwrapDocumentSyncResponseContentKeys(
  input: {
    currentContentKey: Uint8Array;
    currentContentKeyEpoch: number;
    execSql?: ExecSql | undefined;
    response: DocumentSyncResponse;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<number, Uint8Array>> {
  // A stale read-only pass carries no usable content key (the stale bundle
  // wraps to a rotated-away container KEK epoch). Seeding its epoch with the
  // empty placeholder would mark the epoch "resolved" and feed garbage into
  // decryption; leave it unseeded so any served update at that epoch goes
  // through the bundle unwrap below and fails with an honest error instead.
  const contentKeysByEpoch = new Map<number, Uint8Array>(
    input.currentContentKey.byteLength > 0
      ? [[input.currentContentKeyEpoch, input.currentContentKey]]
      : [],
  );
  const bundlesByEpoch = syncResponseContentKeyBundlesByEpoch(input.response);
  const neededContentKeyEpochs = new Set(
    input.response.updates.map(
      (update) =>
        readWriteHeader(
          update.writeHeader,
          "Document sync response write header",
        ).contentKeyEpoch,
    ),
  );
  const missingBundles = [...neededContentKeyEpochs]
    .filter((contentKeyEpoch) => !contentKeysByEpoch.has(contentKeyEpoch))
    .map((contentKeyEpoch) => bundlesByEpoch.get(contentKeyEpoch));
  if (missingBundles.length === 0) {
    return contentKeysByEpoch;
  }

  const containerKeksByEpochId = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  for (const bundle of missingBundles) {
    if (!bundle) {
      throw new Error("Document sync response content-key bundle missing");
    }
    contentKeysByEpoch.set(
      bundle.contentKeyEpoch,
      await unwrapDocumentContentKeyFromBundle(bundle, containerKeksByEpochId),
    );
  }

  return contentKeysByEpoch;
}

/**
 * Builds the rotation baseline that anchors a stale-bundle heal: a full
 * history snapshot of the local document, re-encrypted under the fresh
 * content key so every current member (including post-rotation newcomers)
 * can read the document without the rotated-away container KEK epochs.
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
 * bundle wraps to a rotated-away container KEK epoch that no projection can
 * unwrap anymore, so it splits by intent: a write-bearing pass heals the
 * document by rotating to a FRESH content key at the next epoch (wrapped to
 * the current targets) anchored by a rotation-baseline snapshot, while a
 * read-only pass keeps the stale bundle/targets pair — without unwrapping —
 * so the server can settle the pull against the stored state it actually has.
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
  // There is deliberately no pull-first fallback: the uncovered updates are
  // encrypted under content keys wrapped to the rotated-away container KEK
  // epoch, which no post-rotation projection can unwrap, so pulling cannot
  // extend this device's history. Only a device already holding the full
  // history (typically the author of the uncovered updates) can heal
  // without orphaning them.
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
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>,
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
      containerKeksByEpochId,
      pendingUpdates,
    );
  }

  if (staleContentKeyBundle) {
    traceStaleRead(input.onSyncTrace, {
      documentId: input.writerProjection.documentId,
      epoch: input.writerProjection.contentKeyBundle.contentKeyEpoch,
    });
    // A member who spans the rotation can unwrap the stale bundle through the
    // projection's historical KEK epochs, making pre-rotation updates
    // readable again. Members who do not span it fall back to the empty
    // placeholder: served updates at unreachable epochs then fail decryption
    // with an honest error instead of garbage.
    let staleContentKey: Uint8Array = new Uint8Array();
    try {
      staleContentKey = await unwrapDocumentContentKeyFromBundle(
        input.writerProjection.contentKeyBundle,
        containerKeksByEpochId,
      );
    } catch {
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
      containerKeksByEpochId,
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
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    allowStaleContentKeyBundle: true,
    execSql: input.execSql,
    principalPolicyCache,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const containerKeksByEpochId = await collectContainerKeksForDocumentSync({
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
    material = await resolveSyncPlanContentMaterial(
      input,
      containerKeksByEpochId,
    );
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
  const plan = await buildDocumentSyncPlan({
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

function contentKeyBundleForSyncRequest(
  input: DocumentCreateResponse["contentKeyBundle"],
): NonNullable<DocumentSyncRequest["contentKeyBundle"]> {
  const { documentId: _omit, ...bundle } = input;
  return bundle;
}

async function syncRemoteDocumentResultFromResponse(input: {
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentSyncPlan;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult> {
  const { plan } = input.materializedPlan;
  const persistedState = await persistedDocumentSyncStateFromResponse(
    plan,
    input.response,
    {
      resolveWriterPublicKey: input.resolveWriterPublicKey,
      writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    },
  );
  const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: input.materializedPlan.contentKey,
    currentContentKeyEpoch: plan.contentKeyEpoch,
    execSql: input.execSql,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  const decryptedUpdates = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });
  // Two heal-specific corrections: the synthetic heal baseline matches no
  // pending-queue row, so its ack must not count as a settled pending update;
  // and checkpoints the heal held back ARE settled by it — the committed
  // covering baseline subsumes their full-history content, and resubmitting
  // them post-heal could become the LATEST baseline at the healed epoch and
  // shrink the redirect's coverage below the pre-heal frontier.
  const settledPendingUpdateIds = [
    ...settledPendingUpdateIdsFromSync({
      decryptedUpdates,
      recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
      response: input.response,
    }).filter(
      (updateId) =>
        updateId !== input.materializedPlan.staleRecoveryBaselineUpdateId,
    ),
    ...(input.materializedPlan.heldBackPendingUpdateIds ?? []),
  ];
  const { exhaustedPendingUpdateCount, rekeyedPendingUpdateIds } =
    await rekeyAndReportUnsettledRecoveryPendingUpdates({
      execSql: input.execSql,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
      recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
      rekeyPendingUpdate: input.rekeyPendingUpdate,
      settledPendingUpdateIds,
    });

  return {
    exhaustedPendingUpdateCount,
    contentKey: input.materializedPlan.contentKey,
    decryptedUpdates,
    persistedState,
    plan,
    rekeyedPendingUpdateIds,
    response: input.response,
    settledPendingUpdateIds,
    writerProjection: input.writerProjection,
  };
}

async function completeReadOnlyRemoteDocumentSyncWithProjection(input: {
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection: DocumentWriterProjectionResponse;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult> {
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: input.author,
    execSql: input.execSql,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    onSyncTrace: input.onSyncTrace,
    pendingUpdates: [],
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  return syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input),
    execSql: input.execSql,
    materializedPlan,
    recoveryPendingUpdatesById: new Map(),
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
}

function parsePersistedDocumentSyncRecord<T>(
  value: string | null | undefined,
  label: string,
  isRecord: (value: unknown) => value is T,
): T | null {
  if (!value) {
    return null;
  }

  try {
    const record = readCanonicalRecord(JSON.parse(value), label);
    return isRecord(record) ? record : null;
  } catch {
    return null;
  }
}

function parsePersistedDocumentSyncState(
  persistedState: PersistedDocumentSyncState | null | undefined,
  documentId: string,
): {
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
} | null {
  if (persistedState?.documentId !== documentId) {
    return null;
  }

  const contentKeyBundle = parsePersistedDocumentSyncRecord(
    persistedState.contentKeyBundle,
    "Persisted document sync content-key bundle",
    isDocumentContentKeyBundleResponse,
  );
  const documentKekTargets = parsePersistedDocumentSyncRecord(
    persistedState.documentKekTargets,
    "Persisted document sync KEK targets",
    isDocumentKekTargetsResponse,
  );
  const documentManifest = parsePersistedDocumentSyncRecord(
    persistedState.documentManifestBundle,
    "Persisted document sync manifest",
    isAccessManifestBundleWireResponse,
  );

  if (!contentKeyBundle || !documentKekTargets || !documentManifest) {
    return null;
  }

  return {
    contentKeyBundle,
    documentKekTargets,
    documentManifest,
  };
}

async function buildReadOnlyDocumentSyncPlanFromPersistedState(input: {
  author: DocumentCreateAuthor;
  documentId: string;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  signedAt?: string | undefined;
}): Promise<DocumentSyncPlan | null> {
  const persisted = parsePersistedDocumentSyncState(
    input.persistedState,
    input.documentId,
  );
  if (!persisted) {
    return null;
  }

  return buildDocumentSyncPlan({
    author: input.author,
    contentKeyBundle: persisted.contentKeyBundle,
    documentId: input.documentId,
    documentKekTargets: persisted.documentKekTargets,
    documentManifest: persisted.documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates: [],
    signedAt: input.signedAt,
  });
}

type PersistedReadOnlyDocumentSyncResult =
  | {
      kind: "completed";
      result: SyncRemoteDocumentResult | null;
    }
  | {
      kind: "retry_with_projection";
    }
  | {
      kind: "skipped";
    };

interface ReadOnlyDocumentSyncCompletionInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}

async function tryCompleteReadOnlyRemoteDocumentSyncWithProjection(input: {
  completion: ReadOnlyDocumentSyncCompletionInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await completeReadOnlyRemoteDocumentSyncWithProjection({
      ...input.completion,
      writerProjection: input.writerProjection,
    });
  } catch (error) {
    rethrowKeyingVerificationError(error);
    if (projectionIntegrityErrorCode(error)) {
      throw error;
    }
    return null;
  }
}

async function completeReadOnlyRemoteDocumentSyncWithUpdates(
  input: ReadOnlyDocumentSyncCompletionInput,
): Promise<PersistedReadOnlyDocumentSyncResult> {
  const reusableWriterProjection =
    input.writerProjection?.documentId === input.documentId
      ? input.writerProjection
      : null;
  const writerProjection =
    reusableWriterProjection ??
    (await input.apiClient.getDocumentWriterProjection(input.documentId));
  if (!writerProjection) {
    return { kind: "completed", result: null };
  }

  let result: SyncRemoteDocumentResult | null = null;
  let retryAfterRollback = false;
  try {
    result = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection({
      completion: input,
      writerProjection,
    });
  } catch (error) {
    if (projectionIntegrityErrorCode(error) !== "rollback") {
      throw error;
    }
    retryAfterRollback = true;
  }
  if (result || (!retryAfterRollback && !reusableWriterProjection)) {
    return { kind: "completed", result };
  }

  if (input.apiClient.evictDocumentWriterProjection) {
    input.apiClient.evictDocumentWriterProjection(input.documentId);
  } else {
    input.apiClient.clearWriterProjectionCaches?.();
  }
  const freshWriterProjection =
    await input.apiClient.getDocumentWriterProjection(input.documentId);
  if (!freshWriterProjection) {
    return { kind: "completed", result: null };
  }

  const freshResult = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection(
    {
      completion: input,
      writerProjection: freshWriterProjection,
    },
  );
  return freshResult
    ? { kind: "completed", result: freshResult }
    : { kind: "retry_with_projection" };
}

async function syncReadOnlyRemoteDocumentFromPersistedState(input: {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<PersistedReadOnlyDocumentSyncResult> {
  let plan: DocumentSyncPlan | null;
  try {
    plan = await buildReadOnlyDocumentSyncPlanFromPersistedState(input);
  } catch {
    plan = null;
  }
  if (!plan) {
    return { kind: "skipped" };
  }

  const submitted = await submitDocumentSync({
    apiClient: input.apiClient,
    plan,
  });
  if (!submitted) {
    return { kind: "completed", result: null };
  }
  if (!submitted.ok) {
    if (
      await handleUpstreamDeletedDocumentSyncFailure({
        documentId: input.documentId,
        failure: submitted,
        onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      })
    ) {
      return { kind: "completed", result: null };
    }

    if (isRetryableDocumentSyncConflict(submitted)) {
      traceSubmitFailed(input.onSyncTrace, {
        action: "retry",
        code: submitted.code,
        documentId: input.documentId,
        status: submitted.status,
      });
      return { kind: "retry_with_projection" };
    }

    traceSubmitFailed(input.onSyncTrace, {
      action: "stop",
      code: submitted.code,
      documentId: input.documentId,
      status: submitted.status,
    });
    submitted.report();
    return { kind: "completed", result: null };
  }

  if (submitted.response.updates.length > 0) {
    return completeReadOnlyRemoteDocumentSyncWithUpdates({
      ...input,
      response: submitted.response,
    });
  }

  try {
    const persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      submitted.response,
    );

    return {
      kind: "completed",
      result: {
        contentKey: new Uint8Array(),
        decryptedUpdates: [],
        exhaustedPendingUpdateCount: 0,
        persistedState,
        plan,
        rekeyedPendingUpdateIds: [],
        response: submitted.response,
        settledPendingUpdateIds: [],
      },
    };
  } catch {
    return { kind: "retry_with_projection" };
  }
}

async function resolveDocumentSyncIdentity(
  input: BuildDocumentSyncPlanInput,
): Promise<{
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
}> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.documentManifest,
    label: "Document sync manifest",
  });
  const documentId = input.documentId ?? input.contentKeyBundle.documentId;
  if (documentId.length === 0) {
    throw new Error("Document sync document id is empty");
  }
  if (
    input.contentKeyBundle.documentId !== documentId ||
    input.documentKekTargets.documentId !== documentId ||
    manifestIdentity.documentId !== documentId
  ) {
    throw new Error("Document sync state document id mismatch");
  }
  if (manifestIdentity.organizationId !== input.author.organizationId) {
    throw new Error("Document sync author organization mismatch");
  }
  if (
    input.documentManifest.manifestHash !==
      input.contentKeyBundle.linkSetManifestHash ||
    input.documentKekTargets.linkSetManifestHash !==
      input.contentKeyBundle.linkSetManifestHash
  ) {
    throw new Error("Document sync link manifest mismatch");
  }
  if (
    input.documentKekTargets.documentKeyTargetHash !==
    input.contentKeyBundle.targetHash
  ) {
    throw new Error("Document sync target hash mismatch");
  }

  const kekTargets = normalizeDocumentKekTargetResponse(
    input.documentKekTargets,
  );
  const contentKeyTargets = sortDocumentTargets(
    input.contentKeyBundle.targets.map(targetEnvelopeReference),
  );
  if (
    serializeCanonical(kekTargets, "KEK targets") !==
    serializeCanonical(contentKeyTargets, "content-key targets")
  ) {
    throw new Error("Document sync content-key targets mismatch");
  }

  const targetHash = await computeDocumentContentKeyTargetHash(kekTargets);
  if (targetHash !== input.contentKeyBundle.targetHash) {
    throw new Error("Document sync target hash is not canonical");
  }

  return {
    documentId,
    expectedLinkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: input.contentKeyBundle.targetHash,
    organizationId: manifestIdentity.organizationId,
  };
}

function normalizeAuthorizingContainerPathRefs(
  refs: readonly (readonly ContainerManifestRef[])[] | undefined,
): ContainerManifestRef[][] {
  if (!refs || refs.length === 0) {
    throw new Error("Document sync write authorization path refs are missing");
  }

  return refs.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return [...path];
  });
}

export async function signDocumentOutgoingUpdate(input: {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  signedAt: string;
  update: DocumentSyncPreparedUpdate;
}): Promise<DocumentOutgoingUpdate> {
  const contentRecordId = input.update.contentRecordId ?? input.update.id;
  const nonceDomain = {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  } as const;
  const unsignedHeader: UnsignedWriteHeader = {
    ...nonceDomain,
    accessManifestHash: input.expectedLinkSetManifestHash,
    targetHash: input.expectedTargetHash,
    nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
    metadataHash: input.update.metadataHash,
    ciphertextHash: input.update.ciphertextHash,
    writerUserId: input.author.signerUserId,
    writerDeviceId: input.author.signerDeviceId,
    writerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.update.signedAt ?? input.signedAt,
  };
  const writeHeader = await signWriteHeader(
    unsignedHeader,
    input.author.signerPrivateKey,
  );

  return {
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    ...(input.update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: input.update.checkpointPayloadKind }),
    id: input.update.id,
    encryptedData: input.update.encryptedData,
    partialStartVersionVector: input.update.partialStartVersionVector,
    partialEndVersionVector: input.update.partialEndVersionVector,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Document outgoing write header",
    ),
  };
}

function assertUniqueDocumentOutgoingUpdates(
  updates: readonly DocumentSyncPreparedUpdate[],
): void {
  const updateIds = new Set<string>();
  const contentRecordIds = new Set<string>();
  for (const update of updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document sync update id is duplicated");
    }
    updateIds.add(update.id);

    const contentRecordId = (update.contentRecordId ?? update.id).toLowerCase();
    if (contentRecordIds.has(contentRecordId)) {
      throw new Error("Document sync content record id is duplicated");
    }
    contentRecordIds.add(contentRecordId);
  }
}

interface SyncRemoteDocumentInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  /**
   * Supplies a full-history Loro snapshot of the local document so a
   * write-bearing pass can heal a stale content-key bundle by rotating to a
   * fresh content key anchored by a rotation baseline.
   */
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  documentId: string;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  // Receives the reason whenever this sync returns null, so callers that
  // convert a null result into their own error can name the real cause.
  onSyncAbandoned?: ((reason: string) => void) | undefined;
  /** Clipboard-safe trace sink (see syncTrace.ts); never receives content. */
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}

async function tryPersistedReadOnlyDocumentSync(
  input: SyncRemoteDocumentInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<PersistedReadOnlyDocumentSyncResult | null> {
  if ((input.pendingUpdates ?? []).length > 0) {
    return null;
  }

  return syncReadOnlyRemoteDocumentFromPersistedState({
    apiClient: input.apiClient,
    author: input.author,
    documentId: input.documentId,
    execSql: input.execSql,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncTrace: input.onSyncTrace,
    persistedState: input.persistedState,
    resolveProjectionUserKey,
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
  });
}

export async function buildDocumentSyncPlan(
  input: BuildDocumentSyncPlanInput,
): Promise<DocumentSyncPlan> {
  const {
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
  } = await resolveDocumentSyncIdentity(input);
  const outgoingUpdateInputs = [...(input.outgoingUpdates ?? [])];
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertUniqueDocumentOutgoingUpdates(outgoingUpdateInputs);

  const outgoingUpdates = await Promise.all(
    outgoingUpdateInputs.map((update) =>
      signDocumentOutgoingUpdate({
        author: input.author,
        contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
        documentId,
        expectedLinkSetManifestHash,
        expectedTargetHash,
        organizationId,
        signedAt,
        update,
      }),
    ),
  );
  // Writes always carry the verified current content-key bundle so the server
  // can validate and materialize the current wrapping material in the same
  // request. Read-only syncs omit it because they do not update server state.
  const shouldIncludeContentKeyBundle = outgoingUpdates.length > 0;
  const request: DocumentSyncRequest = {
    ...(shouldIncludeContentKeyBundle
      ? {
          contentKeyBundle: contentKeyBundleForSyncRequest(
            input.contentKeyBundle,
          ),
        }
      : {}),
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    ...(outgoingUpdates.length === 0
      ? {}
      : {
          authorizingContainerPathRefs: normalizeAuthorizingContainerPathRefs(
            input.authorizingContainerPathRefs,
          ),
        }),
    expectedLinkSetManifestHash,
    expectedTargetHash,
    localVersionVector: input.localVersionVector,
    ...(input.minLsn === undefined ? {} : { minLsn: input.minLsn }),
    outgoingUpdates,
  };

  return {
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId,
    documentKekTargets: input.documentKekTargets,
    documentManifest: input.documentManifest,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    minLsn: input.minLsn,
    organizationId,
    request,
    sourceContentKeyBundle: input.contentKeyBundle,
  };
}

/**
 * After a sync submit that healed a stale content-key bundle, the cached
 * projection still carries the bundle that was just superseded; drop it so
 * later passes fetch the healed state instead of pushing another (redundant)
 * epoch bump.
 */
function evictHealedWriterProjection(
  input: SyncRemoteDocumentInput,
  materializedPlan: MaterializedDocumentSyncPlan,
): void {
  if (materializedPlan.healedStaleContentKeyBundle) {
    input.apiClient.evictDocumentWriterProjection?.(input.documentId);
  }
}

function submittedDocumentSyncResult(input: {
  materializedPlan: MaterializedDocumentSyncPlan;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  response: DocumentSyncResponse;
  sync: SyncRemoteDocumentInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult> {
  evictHealedWriterProjection(input.sync, input.materializedPlan);
  if (input.materializedPlan.healedStaleContentKeyBundle) {
    traceHealed(input.sync.onSyncTrace, {
      accepted: input.response.acceptedOutgoingUpdateIds.length,
      documentId: input.materializedPlan.plan.documentId,
      epoch: input.materializedPlan.plan.contentKeyEpoch,
    });
  }
  return syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input.sync),
    execSql: input.sync.execSql,
    materializedPlan: input.materializedPlan,
    onTerminalSubmitFailure: input.sync.onTerminalSubmitFailure,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    rekeyPendingUpdate: input.sync.rekeyPendingUpdate,
    resolveWriterPublicKey: input.sync.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection: input.writerProjection,
    writerPublicKeysByFingerprint: input.sync.writerPublicKeysByFingerprint,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
}

function buildRemoteDocumentSyncPlan(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  projection: DocumentWriterProjectionResponse;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  return buildMaterializedDocumentSyncPlan({
    author: input.sync.author,
    buildRotationSnapshot: input.sync.buildRotationSnapshot,
    execSql: input.sync.execSql,
    localVersionVector: input.sync.localVersionVector,
    minLsn: input.sync.minLsn,
    onSyncTrace: input.sync.onSyncTrace,
    pendingUpdates: input.pendingUpdates,
    regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
    signedAt: input.sync.signedAt,
    targetSecretKey: input.sync.targetSecretKey,
    writerProjection: input.projection,
    ...projectionVerificationOptions(input.sync),
  });
}

/**
 * A retryable stale-projection conflict (stale KEK targets / content-key
 * bundle / write-auth manifest) means our writer projection is behind the
 * server — typically right after a peer shared or rotated a linked
 * container. Drop this document's cached projection so the next attempt
 * re-derives fresh targets instead of resubmitting the same stale ones
 * (which would 409 again and exhaust the retries without converging).
 * Scoped to this document: unrelated projections were not invalidated.
 */
function evictStaleProjectionForRetry(input: SyncRemoteDocumentInput): void {
  input.apiClient.evictDocumentWriterProjection?.(input.documentId);
}

/**
 * A pass may repair a covering-baseline rejection by regenerating queued
 * rotation checkpoints — but only when there is something to regenerate FROM
 * (a snapshot provider and queued checkpoint rows), the failed pass was not
 * already a heal or a regeneration (whose fresh baseline proves this device
 * is simply behind), and an attempt remains.
 */
function canRegenerateQueuedCheckpoints(input: {
  materializedPlan: MaterializedDocumentSyncPlan;
  pendingUpdates: readonly PendingUpdateRecord[];
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}): boolean {
  return (
    !input.regenerateQueuedCheckpoints &&
    !input.materializedPlan.healedStaleContentKeyBundle &&
    input.sync.buildRotationSnapshot !== undefined &&
    input.pendingUpdates.some((update) => update.sourceVersionVector != null)
  );
}

function submitPlannedSyncAttempt(args: {
  attempt: number;
  materializedPlan: MaterializedDocumentSyncPlan;
  maxAttempts: number;
  pendingUpdates: readonly PendingUpdateRecord[];
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
}) {
  return submitDocumentSyncAttemptIfAllowed({
    apiClient: args.sync.apiClient,
    attempt: args.attempt,
    canRegenerateQueuedCheckpoints: canRegenerateQueuedCheckpoints({
      materializedPlan: args.materializedPlan,
      pendingUpdates: args.pendingUpdates,
      regenerateQueuedCheckpoints: args.regenerateQueuedCheckpoints,
      sync: args.sync,
    }),
    documentId: args.sync.documentId,
    isRemoteSyncBlocked: args.sync.isRemoteSyncBlocked,
    maxAttempts: args.maxAttempts,
    onRemoteDocumentDeleted: args.sync.onRemoteDocumentDeleted,
    onSyncTrace: args.sync.onSyncTrace,
    onTerminalSubmitFailure: args.sync.onTerminalSubmitFailure,
    pendingUpdates: args.pendingUpdates,
    plan: args.materializedPlan.plan,
  });
}

function resolveAttemptProjection(
  input: SyncRemoteDocumentInput,
  pendingUpdates: readonly PendingUpdateRecord[],
  reusableWriterProjection: DocumentWriterProjectionResponse | null,
) {
  return resolveSyncAttemptWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncAbandoned: input.onSyncAbandoned,
    onSyncTrace: input.onSyncTrace,
    // Write-bearing passes only: without queued writes a failed projection
    // read blocks nothing durable, so the failure is not recorded.
    onTerminalFailure:
      pendingUpdates.length > 0 ? input.onTerminalSubmitFailure : undefined,
    reusableWriterProjection,
  });
}

export async function syncRemoteDocument(
  input: SyncRemoteDocumentInput,
): Promise<SyncRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document sync",
  );
  const maxAttempts = input.apiClient.syncDocumentResult ? 3 : 1;
  let pendingUpdates = input.pendingUpdates ?? [];
  let recoveryPendingUpdatesById = new Map<string, PendingUpdateRecord>();
  let regenerateQueuedCheckpoints = false;
  let reusableWriterProjection = input.writerProjection ?? null;

  const persistedSync = await tryPersistedReadOnlyDocumentSync(
    input,
    resolveProjectionUserKey,
  );
  if (persistedSync?.kind === "completed") {
    return persistedSync.result;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const writerProjection = await resolveAttemptProjection(
      input,
      pendingUpdates,
      reusableWriterProjection,
    );
    reusableWriterProjection = null;
    if (!writerProjection) {
      return null;
    }
    const planned = await retrySyncPlanOrAbandon({
      apiClient: input.apiClient,
      buildWithProjection: (projection) =>
        buildRemoteDocumentSyncPlan({
          pendingUpdates,
          projection,
          regenerateQueuedCheckpoints,
          sync: input,
        }),
      documentId: input.documentId,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      onSyncAbandoned: input.onSyncAbandoned,
      onSyncTrace: input.onSyncTrace,
      writerProjection,
    });
    if (!planned) {
      return null;
    }
    const [materializedPlan, plannedWriterProjection] = planned;
    const submitted = await submitPlannedSyncAttempt({
      attempt,
      materializedPlan,
      maxAttempts,
      pendingUpdates,
      regenerateQueuedCheckpoints,
      sync: input,
    });
    if (submitted === "retry") {
      evictStaleProjectionForRetry(input);
      continue;
    }
    if (submitted === "stop") {
      input.onSyncAbandoned?.("the sync submit failed terminally");
      return null;
    }
    if (submitted.kind === "regenerate_queued_checkpoints") {
      regenerateQueuedCheckpoints = true;
      continue;
    }
    if (submitted.kind === "recover_update_id_conflict") {
      recoveryPendingUpdatesById = submitted.recoveryPendingUpdatesById;
      pendingUpdates = [];
      continue;
    }

    return submittedDocumentSyncResult({
      materializedPlan,
      recoveryPendingUpdatesById,
      resolveProjectionUserKey,
      response: submitted.response,
      sync: input,
      writerProjection: plannedWriterProjection,
    });
  }

  input.onSyncAbandoned?.("every sync attempt hit a retryable conflict");
  return null;
}
