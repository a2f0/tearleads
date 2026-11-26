import type { AccessEvent } from "@tearleads/crypto";
import type { HistorySegmentSizes } from "@tearleads/loro";
import type {
  ContainerManifestRef,
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import type { DocumentBaselineStageApi } from "../../data/documents/shared/sync/baselineStageApi";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentLinkSetMutationPlan,
} from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { rotationBaselineSigner } from "./baselineStage/rotationBaselineSigner";
import {
  type StagedBaselineCommit,
  settleStagedBaselineCommit,
  writeRotationBaseline,
} from "./baselineStage/rotationBaselineWriter";
import type { StagedBaselineState } from "./baselineStage/stagedBaselineMachine";
import type { DocumentSyncTraceEmitter } from "./sync/syncTrace";

/** The rotation baseline an unlink sends, signed for its new manifest. */
export interface DocumentRotationBaseline {
  /**
   * What the request carries, in index order: the whole group, or the final
   * segment of a staged one.
   */
  readonly segments: DocumentOutgoingUpdate[];
  /** The stage that holds the earlier segments, when the group is staged. */
  readonly staged: {
    readonly baselineStageId: string;
    readonly commit: StagedBaselineCommit;
  } | null;
}

/**
 * The rotation baseline an unlink carries: the proven history in `snapshot`
 * cut into segments, each encrypted under the new epoch's key and signed. A
 * group that fits one request is returned whole; a larger one is uploaded
 * to a stage first and only its final segment returned. Null when there is
 * nothing for a baseline to carry or cover, and `"cancelled"` when the
 * caller stopped wanting it.
 */
export async function buildDocumentRotationBaseline(input: {
  /** The API port; without its stage routes the group is always sent whole. */
  readonly api?: Partial<DocumentBaselineStageApi> | undefined;
  readonly authorizingContainerPathRefs: readonly (readonly ContainerManifestRef[])[];
  readonly author: DocumentCreateAuthor;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  /** The link-set event the unlink signed, which a staged upload keeps. */
  readonly linkSetEvent?: AccessEvent | undefined;
  /** Reads the processed cursor the baseline signs. */
  readonly execSql: ExecSql;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly onTrace?: DocumentSyncTraceEmitter | undefined;
  readonly organizationId: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly signedAt: string;
  readonly snapshot: Uint8Array;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<DocumentRotationBaseline | "cancelled" | null> {
  const signer = rotationBaselineSigner(input);
  // A history never written has no operations and no cursor. There is
  // nothing for a baseline to cover, so the unlink is submitted without one;
  // the server independently proves the committed frontier is empty before
  // accepting it.
  const baseline = await writeRotationBaseline({
    api: input.api ?? {},
    contentKey: input.contentKey,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    execSql: input.execSql,
    // The unlink route takes a larger body than a sync, so a group whose
    // payloads fit a sync request always fits it.
    inlineCharacters: MAX_DOCUMENT_SYNC_REQUEST_BYTES,
    onTrace: input.onTrace,
    organizationId: input.organizationId,
    plan: { linkSetEvent: input.linkSetEvent, signedAt: input.signedAt },
    purpose: "Document unlink",
    segmentSizes: input.segmentSizes,
    signer,
    snapshot: input.snapshot,
    stillCurrent: input.stillCurrent,
  });
  if (baseline.kind === "none") return null;
  if (baseline.kind === "cancelled") return "cancelled";
  const segments: DocumentOutgoingUpdate[] = [];
  for (const update of baseline.segments) {
    segments.push(await signer.sign(update));
  }
  return {
    segments,
    staged:
      baseline.kind === "staged"
        ? { baselineStageId: baseline.baselineStageId, commit: baseline.commit }
        : null,
  };
}

/** A link-set request with its unlink's baseline, ready to submit. */
interface CompletedLinkSetMutationRequest {
  readonly request: DocumentLinkSetMutationRequest;
  /** The staged upload the request commits, to settle with its answer. */
  readonly stagedCommit: StagedBaselineCommit | null;
}

/**
 * The plan's request with the rotation baseline an unlink must carry. A
 * history with no operations and no processed cursor yields no baseline;
 * the unlink is sent without one and the server verifies the committed
 * frontier is empty. Null when the caller stopped wanting the unlink.
 */
export async function completeLinkSetMutationRequest(input: {
  api: Partial<DocumentBaselineStageApi>;
  author: DocumentCreateAuthor;
  /** Reads the processed cursor the unlink baseline signs. */
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentLinkSetMutationPlan;
  onTrace?: DocumentSyncTraceEmitter | undefined;
  /** The sizes to cut the baseline's segments at; the defaults if absent. */
  rotationBaselineSegmentSizes?: HistorySegmentSizes | undefined;
  /** The proven history of an unlink; a link carries no baseline. */
  rotationSnapshot: Uint8Array | undefined;
  signedAt: string;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CompletedLinkSetMutationRequest | null> {
  const { plan } = input.materializedPlan;
  if (plan.operation !== "unlink" || !input.rotationSnapshot) {
    return { request: plan.request, stagedCommit: null };
  }
  const baseline = await buildDocumentRotationBaseline({
    api: input.api,
    authorizingContainerPathRefs: plan.request.authorizingContainerPathRefs,
    author: input.author,
    contentKey: input.materializedPlan.contentKey,
    contentKeyEpoch: plan.contentKeyEpoch,
    documentId: plan.documentId,
    execSql: input.execSql,
    expectedLinkSetManifestHash: plan.manifestHash,
    expectedTargetHash: plan.targetHash,
    linkSetEvent: plan.event,
    onTrace: input.onTrace,
    organizationId: plan.state.organizationId,
    segmentSizes: input.rotationBaselineSegmentSizes,
    signedAt: input.signedAt,
    snapshot: input.rotationSnapshot,
    stillCurrent: input.stillCurrent,
  });
  if (baseline === "cancelled") return null;
  if (!baseline) return { request: plan.request, stagedCommit: null };
  return {
    request: {
      ...plan.request,
      rotationBaseline: baseline.segments,
      ...(baseline.staged
        ? { baselineStageId: baseline.staged.baselineStageId }
        : {}),
    },
    stagedCommit: baseline.staged?.commit ?? null,
  };
}

/**
 * Tell a staged upload what the unlink that carried its final segment got.
 * Returns where the upload stands, or null when the unlink staged nothing.
 */
export async function settleUnlinkBaselineCommit(
  stagedCommit: StagedBaselineCommit | null,
  outcome:
    | { readonly ok: true }
    | {
        readonly baselineStageCode?: string | undefined;
        readonly code?: string | undefined;
        readonly ok: false;
        readonly status?: number | null | undefined;
      },
): Promise<StagedBaselineState | null> {
  if (!stagedCommit) return null;
  return settleStagedBaselineCommit(
    stagedCommit,
    outcome.ok
      ? outcome
      : {
          ...outcome,
          coverageCode:
            DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
        },
  );
}
