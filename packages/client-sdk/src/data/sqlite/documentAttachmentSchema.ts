import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Pending attachment uploads for local document changes.
 *
 * These rows describe attachment blobs referenced by local document mutations
 * that have not yet been folded into the synced attachment/blob projection.
 * Once the attachment is accepted or discarded, the pending row is removed.
 *
 * Columns:
 * - `localId`: Local document id that owns the attachment slot.
 * - `slotId`: Stable attachment slot id within the document.
 * - `name`: User-facing attachment filename.
 * - `mimeType`: Optional MIME type supplied for the blob.
 * - `storageKey`: Local blob storage key for upload/readback.
 * - `byteLength`: Blob size in bytes.
 * - `createdAt`: Queue insertion timestamp used for ordered display.
 *
 * Indexes:
 * - `(localId, slotId)` is the primary key and keeps one pending blob per
 *   document attachment slot.
 * - `mimeType` supports blob-browser MIME grouping and sorting.
 */
export const documentPendingAttachments = sqliteTable(
  "document_pending_attachments",
  {
    localId: text("local_id").notNull(),
    slotId: text("slot_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    contentSha256: text("content_sha256").notNull(),
    createdAt: text("created_at").notNull(),
    // Upload-resume identity, set on the first upload attempt. Reusing the blob
    // id, content key and IV seed makes every encrypted chunk byte-identical, so
    // the persisted multipart stage can resume instead of being orphaned. All
    // nullable: only in-flight uploads have them, and they are dropped with the
    // row once the upload completes.
    uploadBlobId: text("upload_blob_id"),
    uploadContentKey: text("upload_content_key"),
    uploadIv: text("upload_iv"),
    uploadContentKeyEpoch: integer("upload_content_key_epoch"),
    uploadPartSize: integer("upload_part_size"),
    uploadPlaintextSha256: text("upload_plaintext_sha256"),
    uploadStageId: text("upload_stage_id"),
  },
  (table) => [
    primaryKey({ columns: [table.localId, table.slotId] }),
    index("document_pending_attachments_mime_type_idx").on(table.mimeType),
    index("document_pending_attachments_storage_key_idx").on(table.storageKey),
  ],
);

/**
 * Local attachment blob projection for stored documents.
 *
 * This table tracks the attachment blobs currently available to the client for
 * each document slot. `blobId` is optional because the local storage key can be
 * known before the server blob identity has been assigned or downloaded.
 *
 * Columns:
 * - `localId`: Local document id that owns the attachment slot.
 * - `slotId`: Stable attachment slot id within the document.
 * - `blobId`: Server blob id when known.
 * - `storageKey`: Local blob storage key for opening the attachment.
 * - `mimeType`: Optional MIME type associated with the blob.
 * - `byteLength`: Blob size in bytes.
 * - `contentSha256`: Plaintext digest of the bytes held at `storageKey`. The
 *   document content records the digest it intends for the slot; a held copy
 *   whose digest differs is a validly signed served binding the document has
 *   not (yet) recorded, and read models flag it rather than hide it.
 * - `updatedAt`: Local timestamp for the attachment projection update.
 * - `detachedAt`: Local timestamp set when the slot is unlinked from a synced
 *   document. The row outlives the unlink because it is also the durable
 *   "still needs a remote detach" marker (see `syncDetachedAttachments`), so
 *   read models that answer "what references this blob" must skip detached
 *   rows instead of waiting for the detach to flush.
 *
 * Indexes:
 * - `(localId, slotId)` is the primary key and keeps one projected blob per
 *   document attachment slot.
 * - `mimeType` supports blob-browser MIME grouping and sorting.
 */
export const documentAttachmentBlobProjection = sqliteTable(
  "document_attachment_blob_projection",
  {
    localId: text("local_id").notNull(),
    slotId: text("slot_id").notNull(),
    blobId: text("blob_id"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    byteLength: integer("byte_length").notNull(),
    contentSha256: text("content_sha256").notNull(),
    updatedAt: text("updated_at").notNull(),
    detachedAt: text("detached_at"),
  },
  (table) => [
    primaryKey({ columns: [table.localId, table.slotId] }),
    index("document_attachment_blob_projection_mime_type_idx").on(
      table.mimeType,
    ),
    index("document_attachment_blob_projection_storage_key_idx").on(
      table.storageKey,
    ),
  ],
);
