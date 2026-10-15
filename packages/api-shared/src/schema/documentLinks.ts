import { index, pgTable, timestamp, uniqueIndex, uuid } from "./columns";

/**
 * Per-container document unlink tombstones for differential document discovery.
 *
 * A row means the document is no longer currently linked to the container as of
 * `updatedAt`. If the document is linked again later, the current document row
 * will carry a newer sync timestamp and wins in client application order.
 */
export const containerDocumentSyncTombstones = pgTable(
  "container_document_sync_tombstones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    containerId: uuid("container_id").notNull(),
    documentId: uuid("document_id").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_document_sync_tombstones_unique_idx").on(
      table.containerId,
      table.documentId,
    ),
    index("container_document_sync_tombstones_container_updated_idx").on(
      table.containerId,
      table.updatedAt,
      table.documentId,
    ),
  ],
);

/**
 * One-to-one metadata document reservations retained after container deletion.
 * Retired ID pairs deliberately outlive whole-organization purge: they carry
 * no content and prevent another organization from restarting that ID's history.
 * Billing purge owns the separate retention policy for still-live bindings.
 *
 * Every created container can have a metadata document that describes
 * user-facing container metadata through the regular encrypted document path.
 * Metadata documents cannot be structurally relinked as normal documents, so
 * this binding lets document mutation workflows reject relinks for metadata
 * documents. Bindings survive container deletion as ID tombstones: a binding
 * whose container no longer exists prevents a new document history from using
 * the retired metadata ID. Normal document creation still permits metadata
 * initialization while its reserved container is live.
 *
 * Columns:
 * - `containerId`: Container whose metadata document this row binds. This is
 *   the primary key because a container has one metadata document.
 * - `documentId`: Metadata document id. It is unique so one document cannot be
 *   reused as metadata for multiple containers.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const containerMetadataDocuments = pgTable(
  "container_metadata_documents",
  {
    containerId: uuid("container_id").primaryKey(),
    documentId: uuid("document_id").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);
