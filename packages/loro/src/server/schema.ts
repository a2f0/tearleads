import type { InferSelectModel } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdByFingerprint: text("created_by_fingerprint").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentUpdates = pgTable("document_updates", {
  sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
  id: uuid("id").notNull().unique(),
  documentId: uuid("document_id").notNull(),
  authorFingerprint: text("author_fingerprint").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  partialStartVersionVector: text("partial_start_version_vector").notNull(),
  partialEndVersionVector: text("partial_end_version_vector").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DocumentRecord = InferSelectModel<typeof documents>;
export type DocumentUpdateRecord = InferSelectModel<typeof documentUpdates>;
