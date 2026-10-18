import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Listing tombstones held back for lack of signed evidence.
 *
 * A container listing names `(documentId, containerId)` pairs the server says
 * are no longer linked. The pair is only removed from
 * `documentContainerProjection` once the document's verified head link-set
 * manifest omits the container. While that evidence is unavailable (the head
 * cannot be fetched, or the requester no longer reads the document) the pair
 * is held here instead: the row stays, the placement is hidden from container
 * views, and the next discovery of the container retries verification. A
 * verified head that still links the container clears `hidden`, but retains the
 * retry because that head may lag the listing. A later head that omits it applies
 * the removal. All hidden placements remain available through orphan recovery.
 *
 * Columns:
 * - `documentId`: Server document id the tombstone names.
 * - `containerId`: Container the tombstone would unlink the document from.
 * - `tombstonedAt`: Server timestamp carried by the tombstone.
 * - `attempts`: Verification attempts so far; the retry backoff grows with it.
 * - `hidden`: False when signed evidence still links this placement.
 * - `updatedAt`: Local timestamp of the last hold or retry.
 *
 * Indexes:
 * - `(documentId, containerId)` is the primary key: one hold per placement.
 */
export const containerDocumentTombstoneHolds = sqliteTable(
  "container_document_tombstone_holds",
  {
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    tombstonedAt: text("tombstoned_at").notNull(),
    attempts: integer("attempts").notNull().default(1),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.containerId] })],
);
