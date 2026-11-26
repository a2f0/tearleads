import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { satisfiesVersionVector } from "@tearleads/loro";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { getLatestDocumentContentKeyEpoch } from "../../../access/read/documentContentKeyStore";
import type { DocumentBaselineGroup } from "../../../documents/documentBaselineGroup";
import {
  committedFrontierAfterBaselineCursor,
  hasCommittedDocumentUpdate,
} from "./committedDocumentUpdates";
import { DocumentMutationError } from "./errors";
import {
  documentBaselineGroupInvalid,
  readCommittedBaselineGroupState,
  requireOutgoingBaselineGroup,
  selectOutgoingBaselineSegments,
} from "./outgoingBaselineGroup";
import { readWriteHeader } from "./shared/records";

/**
 * A newly written group must be signed at the request's epoch and cover the
 * committed frontier after its cursor. What it covers is read from its
 * segments' spans, which run gapless from zero.
 */
async function assertNewBaselineGroupSound(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly group: DocumentBaselineGroup;
  readonly requestContentKeyEpoch: number;
  readonly segments: readonly DocumentOutgoingUpdate[];
}): Promise<void> {
  for (const segment of input.segments) {
    const header = readWriteHeader(
      segment.writeHeader,
      "Document rotation baseline write header",
    );
    if (header.contentKeyEpoch !== input.requestContentKeyEpoch) {
      throw new DocumentMutationError(
        "Document content-key rotation baseline must use the request content-key epoch",
        409,
      );
    }
  }
  const committedFrontier = await committedFrontierAfterBaselineCursor(
    input.executor,
    {
      coversThroughUpdateId: input.group.coversThroughUpdateId,
      documentId: input.documentId,
    },
  );
  if (!satisfiesVersionVector(input.group.coverage, committedFrontier)) {
    throw new DocumentMutationError(
      "Document content-key rotation baseline does not cover the committed frontier",
      409,
      DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
    );
  }
}

/**
 * Soundness gate for a rotation baseline arriving via document sync.
 *
 * A baseline is an ordered group of updates, its segments, sent together in
 * the request. The group rules (`requireOutgoingBaselineGroup`) hold for any
 * group a request carries, whatever the document holds.
 *
 * A request that ADVANCES the content-key epoch is a rotation (e.g. the
 * stale-bundle heal after a container KEK rotation). Rotated-away epochs
 * become undecryptable for every reader, so the advance must be anchored by a
 * NEWLY WRITTEN baseline that covers the committed frontier after its signed
 * cursor. Otherwise uncovered old-epoch updates are served forever, poison
 * every reader's all-or-nothing decrypt, and the document never converges
 * (mirrors the atomic unlink's
 * assertAtomicRotationBaselineCoversCommittedFrontier). A replayed, already
 * committed group cannot anchor it: the append path's idempotent-retry
 * equality check would keep its ORIGINAL (old-epoch) write headers,
 * advancing the epoch without a baseline readable under the new key.
 *
 * The same coverage rule applies to a newly written baseline that advances
 * nothing: the redirect reads the NEWEST whole group at the current epoch,
 * so a later under-covering one would silently shrink coverage below an
 * existing covering baseline. An idempotent retry of a committed group is
 * exempt: it inserts nothing. A group of which only some segments are
 * committed is refused, because committing the rest would not be one group.
 *
 * A device that is behind must not rotate yet. It can first rematerialize the
 * missing updates through the container predecessor-KEK chain and then retry
 * with a covering baseline; no other device is required. Rejecting a partial
 * baseline preserves the missing data instead of making it the redirect head.
 */
export async function assertSyncRotationBaselinesSound(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  const bundle = input.request.contentKeyBundle;
  const segments = selectOutgoingBaselineSegments(
    input.request.outgoingUpdates,
  );
  const group = segments
    ? await requireOutgoingBaselineGroup({
        documentId: input.documentId,
        requestUpdates: input.request.outgoingUpdates,
        segments,
      })
    : null;
  let advancesEpoch = false;
  if (bundle) {
    const latestEpoch = await getLatestDocumentContentKeyEpoch(
      input.documentId,
      input.executor,
    );
    advancesEpoch =
      latestEpoch !== null && bundle.contentKeyEpoch > latestEpoch;
  }
  if (!group && !advancesEpoch) {
    return;
  }

  if (!(await hasCommittedDocumentUpdate(input.executor, input.documentId))) {
    return;
  }
  if (!segments || !group) {
    throw new DocumentMutationError(
      "Document content-key rotation requires a rotation baseline covering committed updates",
      409,
    );
  }

  const committed = await readCommittedBaselineGroupState(
    input.executor,
    input.documentId,
    segments,
  );
  if (committed === "partial") {
    throw documentBaselineGroupInvalid(
      "some of its segments are committed already",
    );
  }
  if (committed === "committed") {
    if (advancesEpoch) {
      throw new DocumentMutationError(
        "Document content-key rotation baseline must be newly written",
        409,
      );
    }
    return;
  }
  await assertNewBaselineGroupSound({
    documentId: input.documentId,
    executor: input.executor,
    group,
    requestContentKeyEpoch: input.request.contentKeyEpoch,
    segments,
  });
}
