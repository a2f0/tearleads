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
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
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
import type { DocumentBaselineStageApi } from "../../../data/documents/shared/sync/baselineStageApi";
import {
  isDocumentSyncRequestLimitError,
  selectDocumentSyncOutgoingBatch,
} from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type {
  BuildDocumentSyncPlanInput,
  MaterializedDocumentSyncPlan,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentCreateAuthor } from "../../../data/documents/shared/types";
import type { DocumentWriterProjectionAuthorization } from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { rotationBaselineSigner } from "../baselineStage/rotationBaselineSigner";
import {
  releaseStagedBaselineCommit,
  reusableStagedBaselinePlan,
} from "../baselineStage/rotationBaselineWriter";
import {
  type DocumentSyncTraceEmitter,
  traceHealBlocked,
  traceHealPlanned,
  traceStaleBundle,
  traceStaleRead,
} from "../sync/syncTrace";
import {
  type StaleRecoveryBaseline,
  writeStaleRecoveryBaseline,
} from "./staleRecoveryBaseline";
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
  rotationBaseline?: StaleRecoveryBaseline;
}

/** What a plan fixes before it resolves the content it carries. */
interface SyncPlanSigning {
  /** The payload characters a heal's baseline may total to travel whole. */
  readonly inlineBaselineCharacters: number;
  readonly organizationId: string;
  readonly signedAt: string;
}

async function resolveStaleHealMaterial(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>,
  pendingUpdates: readonly PendingUpdateRecord[],
  signing: SyncPlanSigning,
): Promise<ResolvedSyncPlanContentMaterial> {
  const staleEpoch = input.writerProjection.contentKeyBundle.contentKeyEpoch;
  const wrap = (key: Uint8Array) =>
    buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId,
      contentKey: key,
      writerProjection: input.writerProjection,
    });
  let contentKey: Uint8Array = crypto.getRandomValues(new Uint8Array(32));
  let contentKeyBundle = await wrap(contentKey);
  // A baseline part way through a stage was encrypted under a key: the heal
  // that goes on with it wraps that key, not a new one. It may only for the
  // exact target set the key was wrapped for (`reusableStagedBaselinePlan`),
  // which the bundle just built says.
  const held = reusableStagedBaselinePlan(
    input.execSql,
    input.writerProjection.documentId,
    contentKeyBundle.contentKeyEpoch,
    contentKeyBundle.targets,
  );
  if (held) {
    contentKey = held.contentKey;
    contentKeyBundle = await wrap(contentKey);
  }
  // The heal's baseline is the local document's whole history, cut into
  // segments and sent ahead of the pending updates in the same request, or
  // staged ahead of it when the history does not fit.
  //
  // A heal whose baseline does not cover the committed frontier is rejected
  // by the server's covering-baseline gate and surfaces as a terminal queue
  // failure. This write-bearing pass does not pull first. A device missing
  // committed history can independently rematerialize it through predecessor
  // KEKs on a read-only pass, then retry with a covering baseline. The
  // coverage proof prevents a partial local view from becoming the redirect
  // baseline.
  const rotationBaseline = await writeStaleRecoveryBaseline({
    api: input.baselineStageApi ?? {},
    buildRotationSnapshot: input.buildRotationSnapshot,
    contentKey,
    contentKeyBundle,
    execSql: input.execSql,
    inlineCharacters: signing.inlineBaselineCharacters,
    onSyncTrace: input.onSyncTrace,
    organizationId: signing.organizationId,
    segmentSizes: input.rotationBaselineSegmentSizes,
    signedAt: signing.signedAt,
    signer: rotationBaselineSigner({
      author: { ...input.author, organizationId: signing.organizationId },
      authorizingContainerPathRefs: authorizingContainerPathRefs(
        input.writerProjection,
      ),
      contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
      documentId: contentKeyBundle.documentId,
      expectedLinkSetManifestHash: contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: contentKeyBundle.targetHash,
      organizationId: signing.organizationId,
      signedAt: signing.signedAt,
    }),
    stillCurrent: input.stillCurrent,
  });
  // What the request carries of the baseline goes whole or the heal does
  // not go: the pending updates take what room the request has left.
  const selectedPendingUpdates = selectDocumentSyncOutgoingBatch(
    pendingUpdates,
    {
      // A group measured to fit before it was encrypted may be a little
      // over once it is; the request's exact byte check decides that.
      reservedDataCharacters: Math.min(
        MAX_DOCUMENT_SYNC_REQUEST_BYTES,
        rotationBaseline.segments.reduce(
          (sum, segment) => sum + segment.encryptedData.length,
          0,
        ),
      ),
      reservedUpdateCount: rotationBaseline.segments.length,
    },
  );
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
  signing: SyncPlanSigning,
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
      signing,
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
     * The API port's stage routes, through which a heal uploads a baseline
     * that does not fit its request. Without them such a heal cannot go.
     */
    baselineStageApi?: Partial<DocumentBaselineStageApi> | undefined;
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
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document sync manifest",
  });
  const signing = {
    inlineBaselineCharacters: MAX_DOCUMENT_SYNC_REQUEST_BYTES,
    organizationId: manifestIdentity.organizationId,
    signedAt: input.signedAt ?? new Date().toISOString(),
  };
  const context = { collectedKeks, signing, writerAuthorization };
  const planned = await planResolvedSyncContent(input, context);
  if (planned.kind === "planned") return planned.plan;
  // The heal's baseline was cut to travel whole, and the request it leads
  // cannot carry all of it: stage it, so the request carries only its final
  // segment.
  const staged = await planResolvedSyncContent(input, {
    ...context,
    signing: { ...signing, inlineBaselineCharacters: 0 },
  });
  if (staged.kind === "planned") return staged.plan;
  throw staged.error;
}

/** What `buildMaterializedDocumentSyncPlan` verified before it plans. */
interface SyncPlanContext {
  readonly collectedKeks: Awaited<
    ReturnType<typeof collectContainerKeksForDocumentSync>
  >;
  readonly signing: SyncPlanSigning;
  readonly writerAuthorization:
    | DocumentWriterProjectionAuthorization
    | undefined;
}

/**
 * Resolve what the plan carries, encrypt and sign it, and hold the request
 * to its byte ceiling. `oversized` is the one failure the caller answers: a
 * heal's baseline sent whole that the request cannot carry beside the rest
 * of what it holds.
 */
async function planResolvedSyncContent(
  input: Parameters<typeof buildMaterializedDocumentSyncPlan>[0],
  context: SyncPlanContext,
): Promise<
  | { readonly kind: "planned"; readonly plan: MaterializedDocumentSyncPlan }
  | { readonly error: unknown; readonly kind: "oversized" }
> {
  const { collectedKeks, signing } = context;
  const documentId = input.writerProjection.documentId;
  let material: ResolvedSyncPlanContentMaterial;
  try {
    material = await resolveSyncPlanContentMaterial(
      input,
      collectedKeks,
      signing,
    );
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
  const { rotationBaseline } = material;
  try {
    const outgoingUpdates = await prepareDocumentOutgoingUpdates({
      baselineSegments: rotationBaseline?.segments,
      contentKey,
      contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
      documentId,
      organizationId: signing.organizationId,
      pendingUpdates,
    });
    const basePlan = await buildDocumentSyncPlan({
      author: { ...input.author, organizationId: signing.organizationId },
      authorizingContainerPathRefs: authorizingContainerPathRefs(
        input.writerProjection,
      ),
      baselineStageId: rotationBaseline?.baselineStageId,
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
      signedAt: signing.signedAt,
    });
    const plan = finalizeMaterializedDocumentSyncPlan({
      basePlan,
      material,
      writerAuthorization: context.writerAuthorization,
      writerProjection: input.writerProjection,
    });
    return { kind: "planned", plan };
  } catch (error) {
    const sentWhole =
      rotationBaseline !== undefined &&
      rotationBaseline.baselineStageId === undefined &&
      signing.inlineBaselineCharacters > 0;
    if (sentWhole && isDocumentSyncRequestLimitError(error)) {
      return { error, kind: "oversized" };
    }
    // The request that would commit a staged baseline cannot be made: the
    // upload is over, and its stage is not left to hold a place.
    if (rotationBaseline?.stagedCommit) {
      await releaseStagedBaselineCommit(rotationBaseline.stagedCommit);
    }
    throw error;
  }
}
