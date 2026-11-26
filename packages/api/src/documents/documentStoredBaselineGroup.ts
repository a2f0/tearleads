import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import type { DocumentUpdateRecord } from "@tearleads/loro/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { uuidValue } from "../utils/postgresSql";
import type { DocumentBaselineGroup } from "./documentBaselineGroup";

type StoredBaselineFields = Pick<
  DocumentUpdateRecord,
  | "baselineCoversThroughUpdateId"
  | "baselineId"
  | "baselineSegmentCount"
  | "baselineSegmentIndex"
  | "baselineSegmentsDigest"
>;

/**
 * A stored update's baseline fields as its writer signed them: absent where
 * the column is null. An ordinary update has none.
 */
export function storedBaselineSegmentFields(update: StoredBaselineFields): {
  baselineId?: string;
  baselineSegmentCount?: number;
  baselineSegmentIndex?: number;
  baselineSegmentsDigest?: string;
  coversThroughUpdateId?: string;
} {
  return {
    ...(update.baselineId === null ? {} : { baselineId: update.baselineId }),
    ...(update.baselineSegmentCount === null
      ? {}
      : { baselineSegmentCount: update.baselineSegmentCount }),
    ...(update.baselineSegmentIndex === null
      ? {}
      : { baselineSegmentIndex: update.baselineSegmentIndex }),
    ...(update.baselineSegmentsDigest === null
      ? {}
      : { baselineSegmentsDigest: update.baselineSegmentsDigest }),
    ...(update.baselineCoversThroughUpdateId === null
      ? {}
      : { coversThroughUpdateId: update.baselineCoversThroughUpdateId }),
  };
}

/**
 * The content-record metadata hash a stored update's columns give. It equals
 * the hash in the update's signed write header exactly when no signed field
 * of the row, its baseline fields included, differs from what was signed.
 */
export function storedDocumentUpdateMetadataHash(
  update: StoredBaselineFields &
    Pick<
      DocumentUpdateRecord,
      | "dependencyVersionVector"
      | "documentId"
      | "id"
      | "partialEndVersionVector"
      | "partialStartVersionVector"
      | "plaintextHash"
    >,
): Promise<string> {
  return computeDocumentContentRecordMetadataHash({
    ...storedBaselineSegmentFields(update),
    dependencyVersionVector: update.dependencyVersionVector,
    documentId: update.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    updateId: update.id,
  });
}

/** A stored baseline that is whole: which one, and where it starts. */
export interface StoredDocumentBaselineGroupPosition {
  readonly baselineId: string;
  /** The processed cursor its final segment signed, if it signed one. */
  readonly coversThroughUpdateId: string | undefined;
  readonly firstSequence: number;
}

/** A stored baseline that is whole, with what its segments cover. */
export interface StoredDocumentBaselineGroup
  extends DocumentBaselineGroup,
    StoredDocumentBaselineGroupPosition {}

/**
 * How many sealed groups, newest first, are looked at for a whole one. A
 * group commits whole in one transaction, so the newest is whole in every
 * honest database and one look answers. A group that lost a row afterwards
 * is passed over for an older one, this many times at most: past that the
 * answer is none, and the reader is served everything, which loses nothing.
 */
export const MAX_LATEST_BASELINE_GROUP_CANDIDATES = 4;

const wholeGroupSchema = z.object({
  baselineId: z.string(),
  coversThroughUpdateId: z.string().nullable(),
  firstSequence: z.coerce.number().int().positive(),
});

const groupPeerSchema = z.object({
  endCounter: z.coerce.number().int().nonnegative(),
  gapless: z.boolean(),
  peerId: z.string(),
});

interface LatestBaselineGroupInput {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly upperBoundSequence?: number | undefined;
}

/**
 * The newest whole baseline sealed under `contentKeyEpoch` within the bound,
 * found by one statement that reads no payload and no vector. A group is
 * sealed by its final segment, the one row that stores a count. It is whole
 * when its rows within the bound carry the indexes from zero in commit
 * order, the final segment's index is its count less one (so the rows are
 * exactly that many), and no other update of the document was
 * committed among them. So a group of thousands of segments costs what a
 * group of two does to find.
 *
 * Nothing here authenticates a row against its signed header. Every update
 * a pull serves is authenticated as it is served
 * (`authenticateSyncUpdateMetadataForResponse`), so a row altered after its
 * commit fails that pull; it is not this function's to pass over.
 */
export async function findLatestWholeStoredBaselineGroup(
  executor: DatabaseSession,
  input: LatestBaselineGroupInput,
): Promise<StoredDocumentBaselineGroupPosition | null> {
  const documentId = uuidValue(input.documentId);
  const withinBound =
    input.upperBoundSequence === undefined
      ? sql``
      : sql`and sealing.sequence <= ${input.upperBoundSequence}`;
  const result = await executor.execute(sql`
    select sealed.baseline_id::text as "baselineId",
      sealed.baseline_covers_through_update_id::text as "coversThroughUpdateId",
      segments.first_sequence as "firstSequence"
    from (
      select sealing.baseline_id, sealing.sequence, sealing.baseline_segment_count,
        sealing.baseline_segment_index, sealing.baseline_covers_through_update_id
      from ${documentUpdates} sealing
      join ${documentContentWriteHeaders} header
        on header.update_id = sealing.id
      where sealing.document_id = ${documentId}
        and sealing.baseline_id is not null
        and sealing.baseline_segment_count is not null
        and header.content_key_epoch = ${input.contentKeyEpoch}
        ${withinBound}
      order by sealing.sequence desc
      limit ${MAX_LATEST_BASELINE_GROUP_CANDIDATES}
    ) sealed
    cross join lateral (
      select min(placed.sequence) as first_sequence,
        bool_and(placed.baseline_segment_index = placed.place) as in_order
      from (
        select segment.sequence, segment.baseline_segment_index,
          row_number() over (order by segment.sequence) - 1 as place
        from ${documentUpdates} segment
        where segment.document_id = ${documentId}
          and segment.baseline_id = sealed.baseline_id
          and segment.sequence <= sealed.sequence
      ) placed
    ) segments
    where segments.in_order
      and sealed.baseline_segment_index = sealed.baseline_segment_count - 1
      and not exists (
        select 1 from ${documentUpdates} other
        where other.document_id = ${documentId}
          and other.sequence > segments.first_sequence
          and other.sequence < sealed.sequence
          and other.baseline_id is distinct from sealed.baseline_id
      )
    order by sealed.sequence desc
    limit 1
  `);
  const [row] = result.rows;
  if (row === undefined) return null;
  const group = wholeGroupSchema.parse(row);
  return {
    baselineId: group.baselineId,
    coversThroughUpdateId: group.coversThroughUpdateId ?? undefined,
    firstSequence: group.firstSequence,
  };
}

/**
 * What a stored group covers: for each peer, where its segments' spans end.
 * The statement walks the spans as the commit did, in segment order: every
 * span of a peer must start where the one before it ended, the first at
 * zero. A group whose stored spans no longer do covers nothing it can be
 * trusted for, and the answer is null. No vector a segment declares is
 * read.
 */
export async function readStoredBaselineGroupCoverage(
  executor: DatabaseSession,
  input: { readonly baselineId: string; readonly documentId: string },
): Promise<string | null> {
  const documentId = uuidValue(input.documentId);
  const result = await executor.execute(sql`
    select walked.peer_id as "peerId",
      max(walked.end_counter) as "endCounter",
      bool_and(walked.start_counter = walked.previous_end) as "gapless"
    from (
      select span.peer_id, span.start_counter, span.end_counter,
        coalesce(
          lag(span.end_counter) over (
            partition by span.peer_id order by segment.sequence
          ),
          0
        ) as previous_end
      from ${documentUpdates} segment
      join ${documentUpdateSpans} span on span.update_id = segment.id
      where segment.document_id = ${documentId}
        and segment.baseline_id = ${uuidValue(input.baselineId)}
        and span.document_id = ${documentId}
    ) walked
    group by walked.peer_id
  `);
  const peers = result.rows.map((row) => groupPeerSchema.parse(row));
  if (peers.some((peer) => !peer.gapless)) return null;
  return encodeVersionVectorCounters(
    Object.fromEntries(peers.map((peer) => [peer.peerId, peer.endCounter])),
  );
}

/**
 * The latest whole baseline written under `contentKeyEpoch`, with what it
 * covers: of the document's stored baselines at that epoch within the bound,
 * the one sealed last whose rows are still one whole group and whose spans
 * still run gapless, or null. A caller that may not need the coverage finds
 * the group first and reads the coverage only then.
 */
export async function loadLatestStoredDocumentBaselineGroup(
  executor: DatabaseSession,
  input: LatestBaselineGroupInput,
): Promise<StoredDocumentBaselineGroup | null> {
  const group = await findLatestWholeStoredBaselineGroup(executor, input);
  if (!group) return null;
  const coverage = await readStoredBaselineGroupCoverage(executor, {
    baselineId: group.baselineId,
    documentId: input.documentId,
  });
  return coverage === null ? null : { ...group, coverage };
}
