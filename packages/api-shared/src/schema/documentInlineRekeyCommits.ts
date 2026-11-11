import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Durable idempotency markers for document syncs that apply inline rekeys. */
export const documentInlineRekeyCommits = pgTable(
  "document_inline_rekey_commits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commitId: text("commit_id").notNull(),
    documentId: uuid("document_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_inline_rekey_commits_document_commit_idx").on(
      table.documentId,
      table.commitId,
    ),
  ],
);
