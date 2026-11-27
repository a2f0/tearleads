import type { WriteHeader } from "@tearleads/crypto";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Open stages of rotation baselines.
 *
 * A rotation baseline too large for one request is staged: its writer
 * uploads every segment but the final one ahead of time, and the unlink or
 * sync that rotates carries the final segment and names the stage. A stage
 * row exists from the open until that request commits it, its owner abandons
 * or replaces it, or the hourly sweep finds it expired. Nothing staged is
 * served; a commit turns the staged segments into `document_updates` rows.
 *
 * Columns:
 * - `documentId`, `id`: The stage's identity. `id` is the `baselineId` its
 *   segments sign, which the writer chooses, so it names a stage only within
 *   its document.
 * - `organizationId`: The document's organization when the stage opened;
 *   every staged write header must name it.
 * - `ownerUserId`: The only user who may stage to, read, commit or abandon
 *   the stage.
 * - `contentKeyEpoch`, `contentKeyCommitment`: The content key the segments
 *   are encrypted under. A commit requires the epoch the request writes at
 *   and that epoch's stored commitment.
 * - `nextSegmentIndex`: How many segments are staged, and so the index the
 *   next one, or the final one, must carry.
 * - `segmentsDigest`: The baseline digest chain over the staged segments,
 *   which a final segment sent now must sign.
 * - `stagedBytes`: Bytes the stage stores so far: each segment's ciphertext,
 *   signed vectors, plaintext hash and write header. Capped per stage.
 * - `stagedSpans`: Span rows the staged segments declare. Capped per stage,
 *   which bounds what a commit copies under the document head lock.
 * - `expiresAt`: Extended by each staged segment or re-signed header, never
 *   past the maximum lifetime after `createdAt`.
 *
 * Indexes:
 * - `(documentId, ownerUserId)` is unique: one open stage per user and
 *   document, so a writer's abandoned uploads cannot pile up.
 * - `ownerUserId` lists a user's stages, which an open counts against the
 *   per-user cap.
 * - `expiresAt` serves the sweep.
 *
 * Like the update rows, these carry no foreign keys; a document purge
 * deletes them.
 */
export const documentBaselineStages = pgTable(
  "document_baseline_stages",
  {
    documentId: uuid("document_id").notNull(),
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    contentKeyEpoch: integer("content_key_epoch").notNull(),
    contentKeyCommitment: text("content_key_commitment").notNull(),
    nextSegmentIndex: integer("next_segment_index").default(0).notNull(),
    segmentsDigest: text("segments_digest").notNull(),
    stagedBytes: bigint("staged_bytes", { mode: "number" })
      .default(0)
      .notNull(),
    stagedSpans: integer("staged_spans").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "document_baseline_stages_pkey",
      columns: [table.documentId, table.id],
    }),
    uniqueIndex("document_baseline_stages_owner_idx").on(
      table.documentId,
      table.ownerUserId,
    ),
    index("document_baseline_stages_owner_user_idx").on(table.ownerUserId),
    index("document_baseline_stages_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * The segments of staged rotation baselines, and the ciphertext of committed
 * ones.
 *
 * A row is written once, when its segment is staged, and holds everything a
 * `document_updates` row and its write header need. A commit inserts those
 * rows from here, in segment order, without the ciphertext: the committed
 * update row's `encrypted_data` is null and readers take the payload from
 * this row by update id. So a commit, which runs under the document head
 * lock, copies no ciphertext: its update rows hold the signed vectors and
 * hashes, and it copies the staged span rows, one per peer of each segment.
 * The stage's byte and span caps bound both.
 *
 * A row a commit left as its update's payload (the update of the same
 * document and baseline under its id, holding no payload of its own) is
 * deleted only with its document. Every other row belongs to an open stage,
 * or to none any more, and the stage deletes (abandon, replacement, sweep)
 * remove exactly those.
 *
 * Columns:
 * - `updateId`: The segment's update id; the committed update's id.
 * - `documentId`, `baselineId`, `segmentIndex`: The stage, and the segment's
 *   place in it.
 * - `encryptedData`, `byteLength`: The ciphertext envelope and its size.
 * - `partialStartVersionVector`, `partialEndVersionVector`,
 *   `dependencyVersionVector`, `plaintextHash`: The signed fields a commit
 *   copies to the update row.
 * - `header`, `headerHash`: The verified write header. A re-sign replaces
 *   both without touching the ciphertext.
 * - `contentRecordId`, `nonceDomainHash`: The header's content record and
 *   nonce domain, which a re-sign keeps. No two segments of a stage share
 *   either, and a commit requires that no committed update of the document
 *   and epoch holds one, as the committed headers' unique indexes would.
 * - `authorizationHash`: A hash of the header fields that decide whether its
 *   writer may write (the manifest, key-target set, epoch, writer and
 *   citations). A commit requires every staged row to carry the final
 *   segment's, in one statement.
 */
export const documentBaselineSegments = pgTable(
  "document_baseline_segments",
  {
    updateId: uuid("update_id").primaryKey(),
    documentId: uuid("document_id").notNull(),
    baselineId: uuid("baseline_id").notNull(),
    segmentIndex: integer("segment_index").notNull(),
    encryptedData: text("encrypted_data").notNull(),
    byteLength: integer("byte_length").notNull(),
    partialStartVersionVector: text("partial_start_version_vector").notNull(),
    partialEndVersionVector: text("partial_end_version_vector").notNull(),
    dependencyVersionVector: text("dependency_version_vector").notNull(),
    plaintextHash: text("plaintext_hash").notNull(),
    header: jsonb("header").$type<WriteHeader>().notNull(),
    headerHash: text("header_hash").notNull(),
    contentRecordId: text("content_record_id").notNull(),
    nonceDomainHash: text("nonce_domain_hash").notNull(),
    authorizationHash: text("authorization_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_baseline_segments_stage_index_idx").on(
      table.documentId,
      table.baselineId,
      table.segmentIndex,
    ),
    uniqueIndex("document_baseline_segments_content_record_idx").on(
      table.documentId,
      table.baselineId,
      table.contentRecordId,
    ),
    uniqueIndex("document_baseline_segments_nonce_domain_idx").on(
      table.documentId,
      table.baselineId,
      table.nonceDomainHash,
    ),
  ],
);

/**
 * The operation spans of staged segments: for each peer a segment carries,
 * the counters it runs from and to. A stage's frontier on a peer is the
 * highest `endCounter` staged for it, which the next segment must start at,
 * so the staged spans of a peer always run gapless from zero. A commit moves
 * a stage's rows to `document_update_spans`; an abandoned or expired stage's
 * rows are deleted with it.
 */
export const documentBaselineSegmentSpans = pgTable(
  "document_baseline_segment_spans",
  {
    documentId: uuid("document_id").notNull(),
    baselineId: uuid("baseline_id").notNull(),
    updateId: uuid("update_id").notNull(),
    peerId: text("peer_id").notNull(),
    startCounter: integer("start_counter").notNull(),
    endCounter: integer("end_counter").notNull(),
  },
  (table) => [
    primaryKey({
      name: "document_baseline_segment_spans_pkey",
      columns: [table.updateId, table.peerId],
    }),
    index("document_baseline_segment_spans_frontier_idx").on(
      table.documentId,
      table.baselineId,
      table.peerId,
      table.endCounter,
    ),
  ],
);
