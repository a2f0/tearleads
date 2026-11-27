import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentContentWriteHeaders,
  documentPeerOwners,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { DocumentContentKeyTarget, WriteHeader } from "@tearleads/crypto";
import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "@tearleads/validators/response";
import { and, eq, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { deleteDocumentBaselineStage } from "../../../documents/documentBaselineStageStore";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { isUniqueViolation } from "../../../utils/databaseErrors";
import { uuidValue } from "../../../utils/postgresSql";
import {
  documentPeerOwned,
  documentUpdateIdConflict,
  documentUpdatesStoredOutOfOrder,
} from "./errors";
import { documentBaselineGroupInvalid } from "./outgoingBaselineGroup";
import type { StagedBaselineCommit } from "./stagedBaselineCommit";

export interface PromoteStagedBaselineSegmentsInput {
  /** The access epoch of the manifest that authorizes the write. */
  readonly accessEpoch: number;
  /** The key targets the final segment's write was authorized against. */
  readonly authorizationTargets: readonly DocumentContentKeyTarget[];
  readonly commit: StagedBaselineCommit;
  /** The stored commitment of the epoch the request writes at. */
  readonly contentKeyCommitment: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  /** The final segment's header, verified in full by this request. */
  readonly finalHeader: WriteHeader;
  readonly fingerprint: string;
  readonly userId: string;
}

const refusedPeerSchema = z.object({
  committedEndCounter: z.coerce.number().int().nonnegative(),
  peerId: z.string(),
});

const insertedSegmentSchema = z.object({
  segmentIndex: z.coerce.number().int().nonnegative(),
  sequence: z.coerce.number().int().positive(),
});

function stageKey(input: PromoteStagedBaselineSegmentsInput) {
  return { baselineId: input.commit.stage.id, documentId: input.documentId };
}

function stagedSegmentsOf(input: PromoteStagedBaselineSegmentsInput): SQL {
  return sql`document_id = ${uuidValue(input.documentId)}
    and baseline_id = ${uuidValue(input.commit.stage.id)}`;
}

/**
 * The stage is for the content key the request writes under, and every
 * staged header names what the final segment's header names. The request
 * verified the final header in full: its manifest is the one the write is
 * authorized by, its key targets and citations the current ones, its writer
 * the session's user with write access, its key the session's. A staged
 * header was verified for everything but those when it was staged, so one
 * with the same authorization hash passes exactly the checks the final one
 * passed. One statement finds a header that differs.
 */
async function assertStagedHeadersAuthorized(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  const { stage } = input.commit;
  if (stage.contentKeyCommitment !== input.contentKeyCommitment) {
    throw documentBaselineGroupInvalid(
      "its stage is for another content key",
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale,
    );
  }
  const [stale] = await input.executor
    .select({ updateId: documentBaselineSegments.updateId })
    .from(documentBaselineSegments)
    .where(
      and(
        eq(documentBaselineSegments.documentId, input.documentId),
        eq(documentBaselineSegments.baselineId, stage.id),
        ne(
          documentBaselineSegments.authorizationHash,
          writeHeaderAuthorizationHash(input.finalHeader),
        ),
      ),
    )
    .limit(1);
  if (stale) {
    throw documentBaselineGroupInvalid(
      "its staged write headers were signed for another manifest, key-target set or writer key",
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale,
    );
  }
}

/**
 * A staged segment's content record and nonce domain were unused when it was
 * staged; an update committed since may have taken one, and the final
 * segment, whose header this request has stored already, may repeat one. The
 * committed headers keep both unique within a document's epoch, so the
 * insert would fail on them. One statement finds such a segment first and
 * says which stage rule it breaks, so the writer knows the stage cannot
 * commit as it stands.
 */
async function assertStagedContentRecordsUnused(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  const { stage } = input.commit;
  const [taken] = await input.executor
    .select({ updateId: documentBaselineSegments.updateId })
    .from(documentBaselineSegments)
    .innerJoin(
      documentContentWriteHeaders,
      and(
        eq(
          documentContentWriteHeaders.documentId,
          documentBaselineSegments.documentId,
        ),
        eq(documentContentWriteHeaders.contentKeyEpoch, stage.contentKeyEpoch),
        or(
          eq(
            documentContentWriteHeaders.contentRecordId,
            documentBaselineSegments.contentRecordId,
          ),
          eq(
            documentContentWriteHeaders.nonceDomainHash,
            documentBaselineSegments.nonceDomainHash,
          ),
        ),
      ),
    )
    .where(
      and(
        eq(documentBaselineSegments.documentId, input.documentId),
        eq(documentBaselineSegments.baselineId, stage.id),
      ),
    )
    .limit(1);
  if (taken) {
    throw documentBaselineGroupInvalid(
      "a staged segment's content record is already committed",
      DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict,
    );
  }
}

/**
 * The staged peers whose spans end past the document's committed frontier,
 * each with that frontier: the ones the commit extends, as against the ones
 * it only re-asserts. A stage's spans on a peer run gapless from zero, so
 * some staged span of a peer ends past the frontier exactly when the
 * highest does.
 */
function extendedPeers(input: PromoteStagedBaselineSegmentsInput): SQL {
  return sql`
    select staged.peer_id, coalesce(committed.end_counter, 0) as committed_end
    from (
      select peer_id, max(end_counter) as end_counter
      from ${documentBaselineSegmentSpans}
      where ${stagedSegmentsOf(input)}
      group by peer_id
    ) staged
    left join lateral (
      select max(span.end_counter) as end_counter
      from ${documentUpdateSpans} span
      where span.document_id = ${uuidValue(input.documentId)}
        and span.peer_id = staged.peer_id
    ) committed on true
    where staged.end_counter > coalesce(committed.end_counter, 0)`;
}

/**
 * The peer rule of `judgeDocumentPeerSpans`, over the stage's spans as sets:
 * a span that ends at or below a peer's committed frontier re-asserts
 * committed counters, which any writer may do; one that ends past it extends
 * the peer, so the peer must be the writer's or unowned. A staged segment
 * depends only on earlier staged segments, so no dependency is uncommitted
 * once they are.
 *
 * A stage this refuses stays as it was, so its writer can send the commit
 * again, and the check also runs ahead of every commit that is accepted:
 * what it reads is what a writer can make the server read under the head
 * lock. A stage with no span extends nothing and is not read.
 *
 * Otherwise the stage is reduced to one row a peer first, materialized by
 * one pass over the index that holds its spans in peer order. A history
 * staged in many segments names the same peers in every segment, and
 * judging each span would look a peer's committed frontier up once for
 * every span of it. The peers are then joined with the document's peer
 * owners and filtered by the committed spans in a second materialized CTE
 * before `order by ... limit 64`, so the small limit does not lure the
 * planner into a nested-loop anti-join over hundreds of thousands of
 * re-asserted peers. The cost grows with the stage's spans, with the
 * staged peers other users own, and with the refused peers before the
 * limit — never with spans times foreign peers.
 */
async function assertStagedPeersNotOwnedByOthers(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  if (input.commit.stage.stagedSpans === 0) return;
  const documentId = uuidValue(input.documentId);
  const owned = await input.executor.execute(sql`
    with staged as materialized (
      select peer_id, max(end_counter) as end_counter
      from ${documentBaselineSegmentSpans}
      where ${stagedSegmentsOf(input)}
      group by peer_id
    ),
    all_refused as materialized (
      select staged.peer_id
      from staged
      join ${documentPeerOwners} peer_owner
        on peer_owner.document_id = ${documentId}
        and peer_owner.peer_id = staged.peer_id
      where peer_owner.owner_user_id <> ${uuidValue(input.userId)}
        and not exists (
          select 1 from ${documentUpdateSpans} committed
          where committed.document_id = ${documentId}
            and committed.peer_id = staged.peer_id
            and committed.end_counter >= staged.end_counter
        )
    )
    select refused.peer_id as "peerId",
      coalesce((
        select max(span.end_counter)
        from ${documentUpdateSpans} span
        where span.document_id = ${documentId}
          and span.peer_id = refused.peer_id
      ), 0) as "committedEndCounter"
    from (
      select peer_id
      from all_refused
      order by peer_id collate "C"
      limit ${MAX_DOCUMENT_PEER_FRONTIERS}
    ) refused
    order by refused.peer_id collate "C"
  `);
  if (owned.rows.length > 0) {
    throw documentPeerOwned(
      owned.rows.map((row) => refusedPeerSchema.parse(row)),
    );
  }
}

/**
 * Every unowned peer the stage extends becomes the writer's. The caller has
 * refused a stage that extends another user's peer, so each extended peer is
 * the writer's already or nobody's. The final segment and the request's
 * other updates were judged against the frontier this leaves, before it.
 */
async function claimStagedPeers(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  await input.executor.execute(sql`
    insert into ${documentPeerOwners} (document_id, peer_id, owner_user_id)
    select ${uuidValue(input.documentId)}, extended.peer_id,
      ${uuidValue(input.userId)}
    from (${extendedPeers(input)}) extended
    where not exists (
      select 1 from ${documentPeerOwners} peer_owner
      where peer_owner.document_id = ${uuidValue(input.documentId)}
        and peer_owner.peer_id = extended.peer_id
    )
  `);
}

/**
 * An update id names one update everywhere. A staged id that an update has
 * taken since it was staged is read here and refused as an id conflict,
 * before the stage's rows are written.
 */
async function assertStagedUpdateIdsUncommitted(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  const [taken] = await input.executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .innerJoin(
      documentBaselineSegments,
      eq(documentBaselineSegments.updateId, documentUpdates.id),
    )
    .where(
      and(
        eq(documentBaselineSegments.documentId, input.documentId),
        eq(documentBaselineSegments.baselineId, input.commit.stage.id),
      ),
    )
    .limit(1);
  if (taken) throw documentUpdateIdConflict();
}

/**
 * Insert one update row per staged segment, in segment order, with no
 * payload: the ciphertext stays in the staged row, which readers join by
 * update id, so no ciphertext is copied under the document head lock.
 *
 * `assertStagedUpdateIdsUncommitted` found every staged id free. The head
 * lock keeps this document's writers out, but not another document's: one
 * can commit the same id between that read and the insert, and the
 * insert's unique violation is then the same conflict. It is the only
 * unique rule the insert can break: a group's places are unique within its
 * document, and `lockStagedBaselineForCommit` found the stage's baseline id
 * uncommitted under the head lock.
 *
 * `order by segment_index` feeds the insert in segment order, and the
 * identity column takes its values as rows arrive, so sequences rise with
 * the index; Postgres does not promise that, so the returned rows are
 * checked, and so is that every staged index from zero was inserted once.
 */
async function insertStagedUpdateRows(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  const inserted = await input.executor
    .execute(sql`
    insert into ${documentUpdates} (
      id, document_id, access_epoch, author_fingerprint, byte_length,
      partial_start_version_vector, partial_end_version_vector,
      dependency_version_vector, plaintext_hash, baseline_id,
      baseline_segment_index
    )
    select update_id, document_id, ${input.accessEpoch}::int,
      ${input.fingerprint}::text, byte_length, partial_start_version_vector,
      partial_end_version_vector, dependency_version_vector, plaintext_hash,
      baseline_id, segment_index
    from ${documentBaselineSegments}
    where ${stagedSegmentsOf(input)}
    order by segment_index
    returning sequence, baseline_segment_index as "segmentIndex"
  `)
    .catch((error: unknown) => {
      throw isUniqueViolation(error) ? documentUpdateIdConflict() : error;
    });
  const rows = inserted.rows
    .map((row) => insertedSegmentSchema.parse(row))
    .sort((left, right) => left.segmentIndex - right.segmentIndex);
  const inOrder = rows.every(
    (row, position) =>
      row.segmentIndex === position &&
      (position === 0 || row.sequence > (rows[position - 1]?.sequence ?? 0)),
  );
  if (rows.length !== input.commit.stage.nextSegmentIndex || !inOrder) {
    throw documentUpdatesStoredOutOfOrder();
  }
}

/** The staged headers and spans become the committed updates' own. */
async function moveStagedHeadersAndSpans(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  await input.executor.execute(sql`
    insert into ${documentContentWriteHeaders} (
      update_id, document_id, organization_id, content_key_epoch,
      content_record_id, nonce_domain_hash, header_hash, header,
      authorization_targets
    )
    select update_id, document_id, (header->>'organizationId')::uuid,
      (header->>'contentKeyEpoch')::int, header->>'contentRecordId',
      header->>'nonceDomainHash', header_hash, header,
      ${JSON.stringify(input.authorizationTargets)}::jsonb
    from ${documentBaselineSegments}
    where ${stagedSegmentsOf(input)}
  `);
  await input.executor.execute(sql`
    insert into ${documentUpdateSpans} (
      document_id, update_id, peer_id, start_counter, end_counter
    )
    select document_id, update_id, peer_id, start_counter, end_counter
    from ${documentBaselineSegmentSpans}
    where ${stagedSegmentsOf(input)}
  `);
}

/**
 * Whether a stage can be committed ahead of the final segment the request
 * carries. The caller holds the document head lock and the stage's row lock
 * and has verified the final segment's header, held it to the stage
 * (`lockStagedBaselineForCommit`), and proved the group covers the
 * committed frontier. Here: the staged headers are authorized by the final
 * one, none repeats a committed content record, no staged span extends
 * another user's peer, and no staged update id is taken.
 *
 * Nothing is written, and none of these reads the stage's spans as a whole.
 * A refused commit leaves its stage as it was and can be sent again, so
 * what a refusal costs is what a writer can make the server repeat.
 */
export async function assertStagedBaselinePromotable(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  await assertStagedHeadersAuthorized(input);
  await assertStagedContentRecordsUnused(input);
  await assertStagedPeersNotOwnedByOthers(input);
  await assertStagedUpdateIdsUncommitted(input);
}

/**
 * Commit a stage's segments as the document's updates. The caller found the
 * stage promotable (`assertStagedBaselinePromotable`) and the request's own
 * updates acceptable on top of it (`claimDocumentPeers`), in this
 * transaction, under the document head lock. The unowned peers the stage
 * extends become the writer's; the update rows are inserted in segment
 * order by reference; headers and spans follow them; and the stage is
 * deleted, which leaves the staged rows as the committed updates' payloads.
 * These are one update row and one header row per staged segment, one span
 * row per staged span, and at most one peer-owner row per span: the stage's
 * segment and span caps bound them, whatever the ciphertext's size. Every
 * step is in the request's transaction, so a stage commits whole with the
 * rotation or not at all.
 */
export async function promoteStagedBaselineSegments(
  input: PromoteStagedBaselineSegmentsInput,
): Promise<void> {
  await claimStagedPeers(input);
  await insertStagedUpdateRows(input);
  await moveStagedHeadersAndSpans(input);
  // Deletes the stage row and its span rows. Every staged segment row is now
  // a committed update's payload, which this delete never removes.
  await deleteDocumentBaselineStage(input.executor, stageKey(input));
}
