import { type InferSelectModel, sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attributionRevision: integer("attribution_revision").default(0).notNull(),
    attributionIncarnation: uuid("attribution_incarnation")
      .defaultRandom()
      .notNull(),
    createdByFingerprint: text("created_by_fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    discoveryOrder: bigint("discovery_order", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    // How many `document_updates` rows the document holds, kept by the
    // `count_document_updates` trigger in the inserting transaction, so a
    // listing reads it without scanning the document's history.
    updateCount: integer("update_count").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("documents_discovery_idx").on(table.discoveryOrder, table.id),
    index("documents_updated_at_id_idx").on(table.updatedAt, table.id),
  ],
);

export const documentUpdates = pgTable(
  "document_updates",
  {
    sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
    id: uuid("id").notNull().unique(),
    documentId: uuid("document_id").notNull(),
    accessEpoch: integer("access_epoch").notNull(),
    authorFingerprint: text("author_fingerprint").notNull(),
    encryptedData: text("encrypted_data").notNull(),
    byteLength: integer("byte_length").notNull(),
    partialStartVersionVector: text("partial_start_version_vector").notNull(),
    partialEndVersionVector: text("partial_end_version_vector").notNull(),
    // The ops the update depends on outside itself, as its writer signed
    // them: committed when it was accepted, and what readers check the
    // payload's own dependencies against.
    dependencyVersionVector: text("dependency_version_vector").notNull(),
    plaintextHash: text("plaintext_hash").notNull(),
    // Set only on a segment of a rotation baseline, an ordered group of
    // updates committed together that carry the document's whole history at
    // the epoch a rotation opened: the group it belongs to and its place in
    // it, as its writer signed them. What the group covers is read from its
    // segments' spans, so no vector is stored.
    baselineId: uuid("baseline_id"),
    baselineSegmentIndex: integer("baseline_segment_index"),
    // Set only on a baseline's final segment: how many segments the group
    // has, and the signed digest of the ones before it.
    baselineSegmentCount: integer("baseline_segment_count"),
    baselineSegmentsDigest: text("baseline_segments_digest"),
    // Set only on a baseline's final segment that signed one: its author's
    // processed cursor. Updates committed at or before it need no coverage
    // by the group.
    baselineCoversThroughUpdateId: uuid("baseline_covers_through_update_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("document_updates_document_sequence_idx").on(
      table.documentId,
      table.sequence,
    ),
    // A document's baseline segments in commit order: what the redirect
    // reads to find the latest whole group.
    index("document_updates_baseline_idx")
      .on(table.documentId, table.sequence)
      .where(sql`${table.baselineId} is not null`),
    // A group's segments by index; no two share a place.
    uniqueIndex("document_updates_baseline_segment_idx")
      .on(table.baselineId, table.baselineSegmentIndex)
      .where(sql`${table.baselineId} is not null`),
  ],
);

export const documentUpdateSpans = pgTable(
  "document_update_spans",
  {
    documentId: uuid("document_id").notNull(),
    updateId: uuid("update_id").notNull(),
    peerId: text("peer_id").notNull(),
    startCounter: integer("start_counter").notNull(),
    endCounter: integer("end_counter").notNull(),
  },
  (table) => [
    index("document_update_spans_peer_counter_idx").on(
      table.documentId,
      table.peerId,
      table.endCounter,
    ),
    uniqueIndex("document_update_spans_update_peer_idx").on(
      table.updateId,
      table.peerId,
    ),
  ],
);

export type DocumentRecord = InferSelectModel<typeof documents>;
export type DocumentUpdateRecord = InferSelectModel<typeof documentUpdates>;
export type DocumentUpdateSpanRecord = InferSelectModel<
  typeof documentUpdateSpans
>;
