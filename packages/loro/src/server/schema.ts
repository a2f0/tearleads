import type { InferSelectModel } from "drizzle-orm";
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

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdByFingerprint: text("created_by_fingerprint").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentUpdates = pgTable("document_updates", {
  sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
  id: uuid("id").notNull().unique(),
  documentId: uuid("document_id").notNull(),
  accessEpoch: integer("access_epoch").notNull(),
  authorFingerprint: text("author_fingerprint").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  partialStartVersionVector: text("partial_start_version_vector").notNull(),
  partialEndVersionVector: text("partial_end_version_vector").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentUpdateSpans = pgTable(
  "document_update_spans",
  {
    documentId: uuid("document_id").notNull(),
    updateId: uuid("update_id").notNull(),
    peerId: text("peer_id").notNull(),
    startCounter: bigint("start_counter", { mode: "number" }).notNull(),
    endCounter: bigint("end_counter", { mode: "number" }).notNull(),
  },
  (table) => [
    index("document_update_spans_document_idx").on(table.documentId),
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
