import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import {
  type DocumentBaselineGroup,
  documentBaselineGroupFaultMessage,
  judgeDocumentBaselineGroup,
} from "../../../documents/documentBaselineGroup";
import { DocumentMutationError } from "./errors";
import { readWriteHeader } from "./shared/records";

/**
 * The request's rotation baseline is not one whole group. No honest client
 * sends one: it segments a history it proved and signs the group as it goes.
 * A 409 like every coded sync refusal, so both rotation routes carry the
 * code in the body their contracts already describe.
 */
export function documentBaselineGroupInvalid(
  reason: string,
): DocumentMutationError {
  return new DocumentMutationError(
    `Document rotation baseline is not one whole group: ${reason}`,
    409,
    DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
  );
}

/**
 * The rotation baseline segments among a request's updates, in request
 * order, or null when it carries none. A group travels together: an ordinary
 * update between two segments would be committed inside the group, and a
 * reader pages a group as one run.
 */
export function selectOutgoingBaselineSegments(
  updates: readonly DocumentOutgoingUpdate[],
): readonly DocumentOutgoingUpdate[] | null {
  const first = updates.findIndex((update) => update.baselineId !== undefined);
  if (first < 0) return null;
  const last = updates.findLastIndex(
    (update) => update.baselineId !== undefined,
  );
  const run = updates.slice(first, last + 1);
  if (run.some((update) => update.baselineId === undefined)) {
    throw documentBaselineGroupInvalid(
      "other updates sit between its segments",
    );
  }
  return run;
}

/**
 * Hold `segments` to the group rules (`judgeDocumentBaselineGroup`) and
 * return what the group covers. It reads each segment's declared fields and
 * the hashes in its write header; the append that follows verifies every
 * header's signature and that the declared fields are the signed ones, so a
 * group that passes here and commits is the group its writer signed.
 *
 * The group's cursor must not name an update of the request that carries it
 * (`requestUpdates`, the segments themselves when absent). A cursor stands
 * for updates its author judged in a pull it completed, which were committed
 * before the request. One that names an update committed with the group is
 * unknown when the coverage gate reads it, so the gate weighs every update,
 * and known once committed, so a redirect would skip that update unweighed.
 */
export async function requireOutgoingBaselineGroup(input: {
  readonly documentId: string;
  readonly requestUpdates?: readonly DocumentOutgoingUpdate[] | undefined;
  readonly segments: readonly DocumentOutgoingUpdate[];
}): Promise<DocumentBaselineGroup> {
  const verdict = await judgeDocumentBaselineGroup({
    documentId: input.documentId,
    segments: input.segments.map((segment) => {
      const header = readWriteHeader(
        segment.writeHeader,
        "Document rotation baseline write header",
      );
      return {
        baselineId: segment.baselineId,
        baselineSegmentCount: segment.baselineSegmentCount,
        baselineSegmentIndex: segment.baselineSegmentIndex,
        baselineSegmentsDigest: segment.baselineSegmentsDigest,
        ciphertextHash: header.ciphertextHash,
        coversThroughUpdateId: segment.coversThroughUpdateId,
        dependencyVersionVector: segment.dependencyVersionVector,
        metadataHash: header.metadataHash,
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        updateId: segment.id,
      };
    }),
  });
  if (!verdict.ok) {
    throw documentBaselineGroupInvalid(
      documentBaselineGroupFaultMessage(verdict.fault),
    );
  }
  const cursor = verdict.group.coversThroughUpdateId;
  if (
    cursor !== undefined &&
    (input.requestUpdates ?? input.segments).some(({ id }) => id === cursor)
  ) {
    throw documentBaselineGroupInvalid(
      "its cursor names an update of the same request",
    );
  }
  return verdict.group;
}

/** Whether a group is new, wholly committed already, or neither. */
export type CommittedBaselineGroupState = "committed" | "new" | "partial";

/**
 * Whether the group's segments are committed in this document already, by
 * update id; an id another document holds is the append's to refuse. A group
 * commits whole in one transaction, so an honest first attempt finds none of
 * its ids and an honest retry finds them all. Some but not all is `partial`:
 * committing the rest would leave a group that was never written as one. A
 * new group that names a committed group's baseline id is refused by the
 * unique index on a baseline's segments, as a write conflict.
 */
export async function readCommittedBaselineGroupState(
  executor: DatabaseSession,
  documentId: string,
  segments: readonly DocumentOutgoingUpdate[],
): Promise<CommittedBaselineGroupState> {
  const segmentIds = [...new Set(segments.map((segment) => segment.id))];
  const rows = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, documentId),
        inArray(documentUpdates.id, segmentIds),
      ),
    );
  if (rows.length === 0) return "new";
  return rows.length === segmentIds.length ? "committed" : "partial";
}
