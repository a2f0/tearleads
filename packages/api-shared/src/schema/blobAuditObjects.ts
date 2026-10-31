import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "./columns";
import type { BlobAuditRetentionMode } from "./shared";

/**
 * Registry of every blob generation an attachment binding has referenced.
 *
 * Attachment bind, replace, and detach register each referenced blob here
 * before live blob pruning can remove its row. The registry outlives the live
 * `blobs` row: it pins the owning organization, records immutable content
 * metadata, and carries the physical-deletion work item (the storage key while
 * deletion is pending) plus pruning/deletion timestamps. Blob GC, blob
 * authorization, and organization purge read it.
 *
 * Columns:
 * - `blobId`: Primary key matching the committed blob id.
 * - `organizationId`: Organization that owns this blob generation. Retained
 *   after pruning so historical ids cannot become cross-organization probes.
 * - `sha256`: SHA-256 digest of the encrypted blob bytes.
 * - `byteLength`: Byte length of the encrypted blob bytes.
 * - `liveStorageKey`: Storage key for the live blob object when available.
 * - `retentionMode`: Retention policy for the registered blob metadata.
 *   Currently only `live_only` is supported.
 * - `historicalBytesRetained`: Whether historical encrypted bytes are retained
 *   outside the live blob object.
 * - `prunedAt`: Timestamp when live database state was pruned and physical
 *   object deletion became pending.
 * - `objectDeleteAttemptedAt`: Timestamp of the most recent physical deletion
 *   attempt. Pending batches reserve capacity for both new items and retries;
 *   failed items rotate by this timestamp instead of starving the queue.
 * - `objectDeletedAt`: Timestamp when object-store deletion completed. While
 *   this is null on a pruned row, `liveStorageKey` is the durable deletion
 *   work item retried by blob maintenance.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const blobAuditObjects = pgTable(
  "blob_audit_objects",
  {
    blobId: uuid("blob_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    sha256: text("sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    liveStorageKey: text("live_storage_key"),
    retentionMode: text("retention_mode")
      .$type<BlobAuditRetentionMode>()
      .notNull(),
    historicalBytesRetained: boolean("historical_bytes_retained").notNull(),
    prunedAt: timestamp("pruned_at"),
    objectDeleteAttemptedAt: timestamp("object_delete_attempted_at"),
    objectDeletedAt: timestamp("object_deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("blob_audit_objects_organization_idx").on(table.organizationId),
    index("blob_audit_objects_pending_delete_idx")
      .on(table.objectDeleteAttemptedAt, table.prunedAt, table.blobId)
      .where(
        sql`${table.prunedAt} is not null and ${table.objectDeletedAt} is null and ${table.liveStorageKey} is not null`,
      ),
  ],
);
