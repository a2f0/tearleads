import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Current materialized document-to-container links.
 *
 * Document link authority comes from signed document link-set manifests and the
 * per-manifest projection in `accessManifestDocumentLinkProjection`. This table
 * stores the current link set for the document row itself so document workflows
 * can update the structural projection by deleting and reinserting the current
 * linked containers.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `documentId`: Document whose current linked containers are projected.
 * - `containerId`: Currently linked container id.
 * - `createdAt`: Server-side insertion timestamp for the projected link row.
 *
 * Indexes:
 * - `(documentId, containerId)` is unique so a document links a container at
 *   most once in the current projection.
 * - `containerId` supports container-oriented document listing.
 */
export const documentContainerLinks = pgTable(
  "document_container_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    containerId: uuid("container_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_container_links_document_container_idx").on(
      table.documentId,
      table.containerId,
    ),
    index("document_container_links_container_idx").on(table.containerId),
  ],
);

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
 * One-to-one container metadata document bindings.
 *
 * Every created container can have a metadata document that describes
 * user-facing container metadata through the regular encrypted document path.
 * Metadata documents cannot be structurally relinked as normal documents, so
 * this binding lets document mutation workflows reject relinks for metadata
 * documents.
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
