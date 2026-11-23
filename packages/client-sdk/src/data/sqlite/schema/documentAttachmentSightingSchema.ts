import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * The attachment slots a document store saw its document record, kept so a
 * store opened after a restart or reload still detaches a binding whose slot
 * it saw recorded and later reads removed. One row per slot; deleting or
 * rebinding the local record drops its rows.
 *
 * Columns:
 * - `appKind`, `localId`: Document scope matching `documents`.
 * - `slotId`: The attachment slot a published snapshot recorded.
 * - `documentId`: The server document the slot was seen in. A store bound to
 *   another document drops the row instead of reading it. A slot seen before
 *   the record had a server id is written once it gets one.
 * - `seenAt`: When this device first saw the slot recorded.
 */
export const documentRecordedAttachmentSlots = sqliteTable(
  "document_recorded_attachment_slots",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    slotId: text("slot_id").notNull(),
    documentId: text("document_id").notNull(),
    seenAt: text("seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId, table.slotId] }),
  ],
);

export const documentAttachmentSightingTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentRecordedAttachmentSlots),
];
