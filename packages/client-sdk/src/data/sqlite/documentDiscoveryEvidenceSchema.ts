import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Untrusted listing candidates retained until signed placement can be checked. */
export const pendingDocumentDiscoveries = sqliteTable(
  "pending_document_discoveries",
  {
    containerId: text("container_id").notNull(),
    documentId: text("document_id").notNull(),
    accessEpoch: integer("access_epoch").notNull(),
    generation: integer("generation").notNull(),
    inputJson: text("input_json").notNull(),
    retryAt: integer("retry_at").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.containerId, table.documentId] })],
);

/** Only the verified signed head writes this cache, never listing fields. */
export const documentDiscoveryHeads = sqliteTable("document_discovery_heads", {
  documentId: text("document_id").primaryKey(),
  manifestHash: text("manifest_hash").notNull(),
  accessEpoch: integer("access_epoch").notNull(),
  linksJson: text("links_json").notNull(),
});

/** Local request order, independent of untrusted server epoch claims. */
export const documentDiscoverySequence = sqliteTable(
  "document_discovery_sequence",
  {
    id: text("id").primaryKey(),
    generation: integer("generation").notNull(),
    invalidatedThrough: integer("invalidated_through").notNull().default(0),
  },
);
