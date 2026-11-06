import { sql } from "drizzle-orm";
import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { containerDocumentTombstoneHolds } from "./containerDocumentTombstoneHoldSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "./documentAttachmentSchema";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "./documentDiscoveryEvidenceSchema";
import { documentOrphanBlobReclaimTable } from "./documentOrphanBlobReclaimSchema";

/**
 * Local many-to-many projection between documents and containers.
 *
 * The document summary row stores one selected `containerId` for primary list
 * placement, while this table keeps the full set of linked containers returned
 * by container/document sync. Removing a container deletes its links and may
 * repair affected document summary rows to point at another remaining link.
 *
 * Columns:
 * - `documentId`: Server document id whose container links are projected.
 * - `containerId`: Linked container id.
 * - `updatedAt`: Local timestamp for the last replacement of the link set.
 *
 * Indexes:
 * - `(documentId, containerId)` is the primary key and prevents duplicate
 *   links for the same document/container pair.
 * - `(containerId, documentId)` serves the container-filtered link scans
 *   (folder item and sidebar windows) as a covering index search.
 */
export const documentContainerProjection = sqliteTable(
  "document_container_projection",
  {
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.containerId] }),
    index("document_container_projection_container_idx").on(
      table.containerId,
      table.documentId,
    ),
  ],
);

/**
 * Queryable document summary and detail projection.
 *
 * The durable Loro state lives in `documents`. This table stores the fields the
 * app needs for document lists, summaries, and fast detail hydration without
 * opening the full Loro snapshot on every read.
 *
 * Columns:
 * - `localId`: Stable local document id. This joins to `documents.localId` for
 *   rows where `documents.appKind = documents`.
 * - `documentId`: Server document id when known.
 * - `containerId`: Selected container for primary document placement, or
 *   `null` if the document is not currently linked to a visible container.
 * - `organizationId`: Last-known owning organization. Stamped from the
 *   container row when the document is detached because its container was
 *   removed locally (e.g. access to a shared org was revoked and the container
 *   tombstoned), so pending writes keep their org attribution after the
 *   `containers` join source disappears. Read as a fallback only — a live
 *   container join always wins.
 * - `documentKind`: Stored document kind. Defaults to `note`.
 * - `title`: Plain projected title. Defaults to the note fallback title.
 * - `updatedAt`: Timestamp used for document list ordering.
 *
 * The projected full text lives in `documentProjectionText`, keyed by the same
 * `localId`. Keeping it out of this row keeps list/window scans narrow: the
 * sidebar and summary queries read titles and placement from rows whose size
 * does not grow with document content.
 *
 * Indexes:
 * - `localId` is the primary key for document projection lookups.
 * - `(containerId) where containerId is not null` serves container-scoped
 *   window/count scans without walking the whole table.
 * - `(organizationId) where containerId is null` serves the orphan-recovery
 *   existence and window scans.
 * - `(documentId) where documentId is not null` serves the linked-placement
 *   join from `documentContainerProjection` and server-id lookups.
 */
export const documentProjection = sqliteTable(
  "document_projection",
  {
    localId: text("local_id"),
    documentId: text("document_id"),
    containerId: text("container_id"),
    organizationId: text("organization_id"),
    documentKind: text("document_kind").notNull().default("note"),
    title: text("title").notNull().default("Untitled note"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.localId] }),
    index("document_projection_container_idx")
      .on(table.containerId)
      .where(sql`${table.containerId} IS NOT NULL`),
    index("document_projection_orphan_organization_idx")
      .on(table.organizationId)
      .where(sql`${table.containerId} IS NULL`),
    index("document_projection_document_idx")
      .on(table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

/**
 * Projected document text, split from `documentProjection` so content size
 * never bloats the rows that list/window queries scan. Loaded only by detail
 * reads (`loadDocument`) and the save-timestamp change check.
 *
 * Columns:
 * - `localId`: Stable local document id, matching `documentProjection.localId`.
 * - `text`: Plain projected text used to rebuild summaries/details.
 */
export const documentProjectionText = sqliteTable(
  "document_projection_text",
  {
    localId: text("local_id"),
    text: text("text").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId] })],
);

export const documentContainerProjectionTables: ReadonlyArray<SqlTableSchema> =
  [
    defineSqlTableSchema(documentContainerProjection),
    {
      ...defineSqlTableSchema(containerDocumentTombstoneHolds),
      requiredColumns: ["hidden"],
    },
    defineSqlTableSchema(pendingDocumentDiscoveries),
    {
      ...defineSqlTableSchema(documentDiscoveryHeads),
      requiredColumns: ["organization_id"],
    },
    defineSqlTableSchema(documentDiscoverySequence),
  ];

export const documentProjectionTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentProjection),
  defineSqlTableSchema(documentProjectionText),
  {
    ...defineSqlTableSchema(documentPendingAttachments),
    requiredColumns: ["content_sha256"],
  },
  {
    ...defineSqlTableSchema(documentAttachmentBlobProjection),
    requiredColumns: ["content_sha256"],
  },
  documentOrphanBlobReclaimTable,
];
