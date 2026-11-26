import {
  exportFullHistorySnapshot,
  type HistorySegmentSizes,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authorizingContainerPathRefs } from "../../../src/data/documents/shared/projection";
import { openDocumentContentKey } from "../../../src/data/documents/shared/sync/contentKeyCommitment";
import type { DocumentSyncPlan } from "../../../src/data/documents/shared/sync/documentSyncTypes";
import type { DocumentCreateAuthor } from "../../../src/data/documents/shared/types";
import {
  emptyRotationBaselineSegment,
  encryptRotationBaselineGroup,
  segmentRotationSnapshot,
} from "../../../src/workflows/documents/syncPlan/rotationBaselineGroup";
import { signDocumentOutgoingUpdate } from "../../../src/workflows/documents/syncPlan/syncPlanIdentity";
import { servedUpdateFromOutgoing } from "../data/rotationBaselineFixtures";

type FixtureDocument = Parameters<typeof exportFullHistorySnapshot>[0];
type ServedUpdate = DocumentSyncResponse["updates"][number];

/**
 * A rotation baseline of `document`, as its writer builds and signs one and
 * the server serves it: the document's whole history cut into segments (one
 * unless `segmentSizes` is small), each encrypted under the plan's content
 * key. `segmentIds` names the segments' update ids, in order, where a test
 * needs to know them; `emptyWithCursor` signs a document with no operations
 * as the one empty segment an all-void history gives.
 */
export async function createServedRotationBaseline(input: {
  readonly author: DocumentCreateAuthor;
  readonly contentKey: Uint8Array;
  readonly coversThroughUpdateId?: string | undefined;
  readonly document: FixtureDocument;
  readonly plan: Pick<
    DocumentSyncPlan,
    | "contentKeyEpoch"
    | "documentId"
    | "expectedLinkSetManifestHash"
    | "expectedTargetHash"
    | "organizationId"
  >;
  readonly segmentIds?: readonly string[] | undefined;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly signedAt?: string | undefined;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): Promise<{
  readonly baselineId: string;
  readonly outgoing: DocumentOutgoingUpdate[];
  readonly updates: ServedUpdate[];
  /** The version the baseline's segments reach together. */
  readonly version: string;
}> {
  const { plan } = input;
  const history = segmentRotationSnapshot({
    purpose: "Rotation baseline fixture",
    segmentSizes: input.segmentSizes,
    snapshot: exportFullHistorySnapshot(input.document),
  });
  const segments = (
    history.segments.length === 0
      ? [emptyRotationBaselineSegment()]
      : history.segments
  ).map((segment, index) => ({
    ...segment,
    id: input.segmentIds?.[index] ?? segment.id,
  }));
  const prepared = await encryptRotationBaselineGroup({
    baselineId: history.baselineId,
    contentKey: await openDocumentContentKey({
      contentKey: input.contentKey,
      contentKeyEpoch: plan.contentKeyEpoch,
      documentId: plan.documentId,
    }),
    contentKeyEpoch: plan.contentKeyEpoch,
    coversThroughUpdateId: input.coversThroughUpdateId,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    segments,
  });
  const outgoing: DocumentOutgoingUpdate[] = [];
  for (const update of prepared) {
    outgoing.push(
      await signDocumentOutgoingUpdate({
        author: input.author,
        authorizingContainerPathRefs: authorizingContainerPathRefs(
          input.writerProjection,
        ),
        contentKeyEpoch: plan.contentKeyEpoch,
        documentId: plan.documentId,
        expectedLinkSetManifestHash: plan.expectedLinkSetManifestHash,
        expectedTargetHash: plan.expectedTargetHash,
        organizationId: plan.organizationId,
        signedAt: input.signedAt ?? "2026-04-27T00:00:00.000Z",
        update,
      }),
    );
  }
  return {
    baselineId: history.baselineId,
    outgoing,
    updates: outgoing.map((update) =>
      servedUpdateFromOutgoing({
        author: input.author,
        documentId: plan.documentId,
        update,
        writerProjection: input.writerProjection,
      }),
    ),
    version: history.version,
  };
}
