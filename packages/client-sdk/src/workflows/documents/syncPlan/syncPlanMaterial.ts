import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { HistorySegmentSizes } from "@tearleads/loro";
import type {
  AccessManifestBundleWireResponse,
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { documentKekTargetsFromContentKeyBundle } from "@tearleads/validators/response";
import { assertDocumentKekPathsCurrent } from "../../../data/documents/shared/containerKek/containerKekCurrency";
import {
  assertDocumentWriterProjectionConsistent,
  authorizingContainerPathRefs,
  buildRotatedDocumentContentKeyBundle,
  ContainerKekHistoryUnavailableError,
  collectContainerKeksForDocumentSync,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
} from "../../../data/documents/shared/projection";
import type { ProjectionVerificationOptions } from "../../../data/documents/shared/projection/projectionVerificationOptions";
import { projectionVerificationOptions } from "../../../data/documents/shared/projection/projectionVerificationOptions";
import { assertDocumentManifestBundleConsistent } from "../../../data/documents/shared/readers";
import { selectDocumentSyncOutgoingBatch } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type {
  BuildDocumentSyncPlanInput,
  MaterializedDocumentSyncPlan,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentCreateAuthor } from "../../../data/documents/shared/types";
import type { DocumentWriterProjectionAuthorization } from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentSyncTraceEmitter,
  traceHealBlocked,
  traceHealPlanned,
  traceStaleBundle,
  traceStaleRead,
} from "../sync/syncTrace";
import {
  type DocumentRotationBaselineHistory,
  rotationBaselineDataCharacters,
} from "./rotationBaselineGroup";
import { buildStaleRecoveryBaseline } from "./staleRecoveryBaseline";
import { prepareDocumentOutgoingUpdates } from "./syncContentKeys";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { finalizeMaterializedDocumentSyncPlan } from "./syncPlanProjection";

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
): AccessManifestBundleWireResponse {
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

interface ResolvedSyncPlanContentMaterial {
  contentKey: Uint8Array;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
  documentManifest: AccessManifestBundleWireResponse;
  healedStaleContentKeyBundle: boolean;
  pendingUpdates: readonly PendingUpdateRecord[];
  /** The baseline a heal sends ahead of its pending updates. */
  rotationBaseline?: DocumentRotationBaselineHistory;
}

async function resolveStaleHealMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>,
  pendingUpdates: readonly PendingUpdateRecord[],
): Promise<ResolvedSyncPlanContentMaterial> {
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  // The heal's baseline is the local document's whole history, cut into
  // segments and sent ahead of the pending updates in the same request.
  //
  // A heal whose baseline does not cover the committed frontier is rejected
  // by the server's covering-baseline gate and surfaces as a terminal queue
  // failure. This write-bearing pass does not pull first. A device missing
  // committed history can independently rematerialize it through predecessor
  // KEKs on a read-only pass, then retry with a covering baseline. The
  // coverage proof prevents a partial local view from becoming the redirect
  // baseline.
  const rotationBaseline = await buildStaleRecoveryBaseline(
    input.buildRotationSnapshot,
    input.rotationBaselineSegmentSizes,
  );
  // The baseline goes whole or the heal does not go: the pending updates
  // take what room the request has left.
  const selectedPendingUpdates = selectDocumentSyncOutgoingBatch(
    pendingUpdates,
    {
      reservedDataCharacters: rotationBaselineDataCharacters(rotationBaseline),
      reservedUpdateCount: rotationBaseline.segments.length,
    },
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
    segments: rotationBaseline.segments.length,
    toEpoch: contentKeyBundle.contentKeyEpoch,
    updates: selectedPendingUpdates.length,
  });
  return {
    contentKey,
    contentKeyBundle,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    healedStaleContentKeyBundle: true,
    pendingUpdates: selectedPendingUpdates,
    rotationBaseline,
  };
}

async function resolveSyncPlanContentMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  collectedKeks: Awaited<
    ReturnType<typeof collectContainerKeksForDocumentSync>
  >,
): Promise<ResolvedSyncPlanContentMaterial> {
  const allPendingUpdates = input.pendingUpdates ?? [];
  if (allPendingUpdates.length > 0) {
    assertDocumentKekPathsCurrent(input.writerProjection);
  }
  const staleContentKeyBundle =
    input.writerProjection.contentKeyBundleStale === true;

  if (staleContentKeyBundle && allPendingUpdates.length > 0) {
    traceStaleBundle(input.onSyncTrace, {
      documentId: input.writerProjection.documentId,
      epoch: input.writerProjection.contentKeyBundle.contentKeyEpoch,
      pending: allPendingUpdates.length,
    });
    return resolveStaleHealMaterial(
      input,
      collectedKeks.keksByEpochId,
      allPendingUpdates,
    );
  }

  const pendingUpdates = selectDocumentSyncOutgoingBatch(allPendingUpdates);

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
        input.writerProjection.documentId,
        collectedKeks.keksByEpochId,
        collectedKeks.predecessorFailuresByEpochId,
        collectedKeks.unattributedPredecessorFailuresByContainerId,
      );
    } catch (error) {
      if (
        error instanceof DocumentHistoryUnavailableError &&
        (input.historyMode !== "raw" ||
          !(error.historyCause instanceof ContainerKekHistoryUnavailableError))
      ) {
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
      pendingUpdates,
    };
  }

  return {
    contentKey: await unwrapDocumentContentKeyFromBundle(
      input.writerProjection.contentKeyBundle,
      input.writerProjection.documentId,
      collectedKeks.keksByEpochId,
      collectedKeks.predecessorFailuresByEpochId,
      collectedKeks.unattributedPredecessorFailuresByContainerId,
    ),
    contentKeyBundle: input.writerProjection.contentKeyBundle,
    documentKekTargets: input.writerProjection.documentKekTargets,
    documentManifest: input.writerProjection.documentManifest,
    healedStaleContentKeyBundle: false,
    pendingUpdates,
  };
}

export async function buildMaterializedDocumentSyncPlan(
  input: {
    author: DocumentCreateAuthor;
    /**
     * Supplies a full-history Loro snapshot of the local document when a
     * stale content-key bundle must be healed. Without it that pass fails
     * with a descriptive error instead.
     */
    buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
    containerRekeys?: BuildDocumentSyncPlanInput["containerRekeys"];
    execSql?: ExecSql | undefined;
    historyMode?: "raw" | undefined;
    inlineRekeyCommitId?: string | undefined;
    localVersionVector: string | null;
    maxPageUpdates?: number | undefined;
    minLsn?: string | undefined;
    processedThroughUpdateId?: string | undefined;
    pullCursor?: string | undefined;
    /** Clipboard-safe trace sink (see syncTrace.ts); never receives content. */
    onSyncTrace?: DocumentSyncTraceEmitter | undefined;
    pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
    persistVerificationCheckpoints?: boolean | undefined;
    /**
     * The sizes a heal cuts its baseline's segments at; Loro's defaults when
     * absent.
     */
    rotationBaselineSegmentSizes?: HistorySegmentSizes | undefined;
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
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
    onVerifiedAuthorization: (authorization) => {
      writerAuthorization = authorization;
    },
    principalPolicyCache,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const collectedKeks = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
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
    // Only a stale-bundle HEAL (write-bearing) counts as a blocked recovery;
    // an ordinary pass or a stale READ failing here must not read as one in
    // a support report. Enumerated reason only; unknown errors emit nothing
    // (fail closed).
    if (
      input.writerProjection.contentKeyBundleStale === true &&
      (input.pendingUpdates ?? []).length > 0
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
    pendingUpdates,
  } = material;
  const outgoingUpdates = await prepareDocumentOutgoingUpdates({
    contentKey,
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    documentId,
    execSql: input.execSql,
    organizationId: manifestIdentity.organizationId,
    pendingUpdates,
    rotationBaseline: material.rotationBaseline,
  });
  const basePlan = await buildDocumentSyncPlan({
    author: {
      ...input.author,
      organizationId: manifestIdentity.organizationId,
    },
    authorizingContainerPathRefs: authorizingContainerPathRefs(
      input.writerProjection,
    ),
    containerRekeys: input.containerRekeys,
    contentKeyBundle,
    documentId,
    documentKekTargets,
    documentManifest,
    historyMode: input.historyMode,
    inlineRekeyCommitId: input.inlineRekeyCommitId,
    localVersionVector: input.localVersionVector,
    maxPageUpdates: input.maxPageUpdates,
    minLsn: input.minLsn,
    outgoingUpdates,
    processedThroughUpdateId: input.processedThroughUpdateId,
    pullCursor: input.pullCursor,
    signedAt: input.signedAt,
  });
  return finalizeMaterializedDocumentSyncPlan({
    basePlan,
    material,
    writerAuthorization,
    writerProjection: input.writerProjection,
  });
}
