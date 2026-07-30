import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** Durable byte-reclamation queue populated before orphan attachment rows go. */
export const documentOrphanBlobReclaims = sqliteTable(
  "document_orphan_blob_reclaims",
  { storageKey: text("storage_key").primaryKey() },
);

export const documentOrphanBlobReclaimTable = defineSqlTableSchema(
  documentOrphanBlobReclaims,
);
