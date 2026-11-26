import type { HistorySegmentSizes } from "@tearleads/loro";
import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import { openDocumentContentKey } from "../../data/documents/shared/sync/contentKeyCommitment";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetMutationOperation,
  MaterializedDocumentLinkSetMutationPlan,
} from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { readProcessedCursorForVersion } from "./sync/processedCursor";
import {
  emptyRotationBaselineSegment,
  encryptRotationBaselineGroup,
  segmentRotationSnapshot,
} from "./syncPlan/rotationBaselineGroup";
import { signDocumentOutgoingUpdate } from "./syncPlan/syncPlanIdentity";

// A history with no operations and no processed cursor yields no baseline;
// the unlink is sent without one and the server verifies the committed
// frontier is empty.
export async function completeLinkSetMutationRequest(input: {
  author: DocumentCreateAuthor;
  /** Reads the processed cursor the unlink baseline signs. */
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentLinkSetMutationPlan;
  operation: DocumentLinkSetMutationOperation;
  /** The sizes to cut the baseline's segments at; Loro's defaults if absent. */
  rotationBaselineSegmentSizes?: HistorySegmentSizes | undefined;
  rotationSnapshot: Uint8Array | undefined;
  signedAt: string;
}) {
  const rotationBaseline =
    input.operation === "unlink" && input.rotationSnapshot
      ? await buildDocumentRotationBaseline({
          authorizingContainerPathRefs:
            input.materializedPlan.plan.request.authorizingContainerPathRefs,
          author: input.author,
          contentKey: input.materializedPlan.contentKey,
          contentKeyEpoch: input.materializedPlan.plan.contentKeyEpoch,
          documentId: input.materializedPlan.plan.documentId,
          execSql: input.execSql,
          expectedLinkSetManifestHash: input.materializedPlan.plan.manifestHash,
          expectedTargetHash: input.materializedPlan.plan.targetHash,
          organizationId: input.materializedPlan.plan.state.organizationId,
          segmentSizes: input.rotationBaselineSegmentSizes,
          signedAt: input.signedAt,
          snapshot: input.rotationSnapshot,
        })
      : null;
  return rotationBaseline
    ? { ...input.materializedPlan.plan.request, rotationBaseline }
    : input.materializedPlan.plan.request;
}

/**
 * The rotation baseline an unlink carries: the proven history in `snapshot`
 * cut into segments, each encrypted under the new epoch's key and signed, in
 * index order. Null when there is nothing for a baseline to carry or cover.
 */
export async function buildDocumentRotationBaseline(input: {
  readonly authorizingContainerPathRefs: readonly (readonly ContainerManifestRef[])[];
  readonly author: DocumentCreateAuthor;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly organizationId: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly signedAt: string;
  readonly snapshot: Uint8Array;
}): Promise<DocumentOutgoingUpdate[] | null> {
  const history = segmentRotationSnapshot({
    purpose: "Document unlink",
    segmentSizes: input.segmentSizes,
    snapshot: input.snapshot,
  });
  // Updates the history's author voided need no coverage past its cursor.
  const coversThroughUpdateId = await readProcessedCursorForVersion(
    input.execSql,
    { documentId: input.documentId, version: history.version },
  );
  if (history.segments.length === 0 && coversThroughUpdateId === undefined) {
    // A document never written has no operations and no cursor. There is
    // nothing for a rotation baseline to cover, so the unlink is submitted
    // without one; the server independently proves the committed frontier is
    // empty before accepting it.
    return null;
  }
  const prepared = await encryptRotationBaselineGroup({
    baselineId: history.baselineId,
    contentKey: await openDocumentContentKey(input),
    contentKeyEpoch: input.contentKeyEpoch,
    coversThroughUpdateId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    // Every update through the cursor was void, so the history is empty. The
    // one empty segment still signs the cursor, and the API asks the
    // baseline to cover only the updates after it.
    segments:
      history.segments.length === 0
        ? [emptyRotationBaselineSegment()]
        : history.segments,
  });
  const signed: DocumentOutgoingUpdate[] = [];
  for (const update of prepared) {
    signed.push(
      await signDocumentOutgoingUpdate({
        authorizingContainerPathRefs: input.authorizingContainerPathRefs,
        author: input.author,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        expectedLinkSetManifestHash: input.expectedLinkSetManifestHash,
        expectedTargetHash: input.expectedTargetHash,
        organizationId: input.organizationId,
        signedAt: input.signedAt,
        update,
      }),
    );
  }
  return signed;
}
