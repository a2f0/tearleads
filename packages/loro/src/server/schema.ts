import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

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
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
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
    plaintextHash: text("plaintext_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("document_updates_document_sequence_idx").on(
      table.documentId,
      table.sequence,
    ),
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
