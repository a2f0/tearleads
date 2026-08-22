import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

/**
 * Committed encrypted blob payloads.
 *
 * A blob row points to encrypted bytes after a staged upload has been promoted
 * by an authorized attachment mutation. Access to bytes is checked through
 * current attachment bindings and document/container access before the object
 * is returned.
 *
 * Columns:
 * - `id`: Stable blob id.
 * - `storageKey`: Storage key for the encrypted bytes.
 * - `sha256`: SHA-256 digest of the encrypted object.
 * - `byteLength`: Byte length of the encrypted object.
 * - `createdAt`: Server-side promotion timestamp.
 * - `dereferencedAt`: Set when detach, replacement, or purge leaves this blob
 *   without an active attachment binding. The bytes are retained during a GC
 *   grace period; a later sweep locks the blob and re-checks active reachability
 *   before pruning live state. A bind that re-references it clears this back to
 *   `null`. Null while live.
 * - `reclaimAttemptedAt`: Most recent failed live-state reclaim attempt. This
 *   places corrupt work in a retry class with reserved batch capacity without
 *   changing the lifecycle-defining `dereferencedAt`. Cleared when revived.
 */
export const blobs = pgTable(
  "blobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    dereferencedAt: timestamp("dereferenced_at"),
    reclaimAttemptedAt: timestamp("reclaim_attempted_at"),
  },
  (table) => [
    // One blob row per object-store key: a blob is 1:1 with its bytes (sharing
    // across documents goes through attachment_bindings, not duplicate rows).
    // This makes a second concurrent bind that aliases an already-consumed
    // stage's storage key conflict and fail closed instead of creating two blob
    // rows over one object (which would break storage-key GC reachability).
    uniqueIndex("blobs_storage_key_idx").on(table.storageKey),
    index("blobs_dereferenced_at_idx")
      .on(table.dereferencedAt)
      .where(sql`${table.dereferencedAt} is not null`),
    index("blobs_reclaim_attempted_at_idx")
      .on(table.reclaimAttemptedAt, table.dereferencedAt, table.id)
      .where(
        sql`${table.reclaimAttemptedAt} is not null and ${table.dereferencedAt} is not null`,
      ),
  ],
);

/**
 * Temporary encrypted blob uploads awaiting attachment mutation.
 *
 * Staging lets a user upload encrypted bytes and receive a stage id before the
 * authorized attachment mutation promotes those bytes into `blobs`. Promotion
 * requires the same owner user, a non-expired stage, and matching blob write
 * header/ciphertext hash. Promoted stages are deleted.
 *
 * Columns:
 * - `id`: Stage id returned to the client.
 * - `ownerUserId`: User who created the stage and is allowed to promote it.
 * - `storageKey`: Object-store key used for the multipart upload.
 * - `uploadId`: Object-store multipart upload id.
 * - `completedAt`: Multipart completion timestamp; null while pending.
 * - `sha256`: Expected SHA-256 digest of the completed encrypted object.
 * - `byteLength`: Expected byte length of the completed encrypted object.
 * - `expiresAt`: Expiration timestamp after which promotion is rejected.
 * - `createdAt`: Server-side staging timestamp.
 */
export const blobStages = pgTable(
  "blob_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadId: text("upload_id").notNull(),
    completedAt: timestamp("completed_at"),
    sha256: text("sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("blob_stages_expires_at_idx").on(table.expiresAt, table.id),
  ],
);

/**
 * Materialized attachment bindings between documents, slots, and blobs.
 *
 * Attachment bindings are written from verified attachment access events. A
 * binding attaches a blob to one logical document slot; replacing a slot points
 * at the previous binding, and detaching marks the active binding with
 * `detachedAt`. The partial unique index enforces one active binding per
 * document slot.
 *
 * Columns:
 * - `id`: Stable attachment binding id.
 * - `documentId`: Document that owns the attachment slot.
 * - `slotId`: Logical attachment slot within the document.
 * - `blobId`: Blob attached to the slot.
 * - `previousBindingId`: Previous binding in the slot chain for replacement
 *   flows, or `null` for the first binding.
 * - `attachmentEventHash`: Access event hash that created this binding.
 * - `documentManifestHash`: Document link-set manifest hash verified for the
 *   binding.
 * - `detachedAt`: Timestamp when this binding was detached, or `null` while it
 *   is active.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `documentId` supports document attachment listing.
 * - `blobId` supports resolving documents that currently expose a blob.
 * - `previousBindingId` supports slot-chain diagnostics.
 * - `attachmentEventHash` supports access-event correlation.
 * - `(documentId, slotId) where detachedAt is null` is unique so one document
 *   slot has at most one active binding.
 */
export const attachmentBindings = pgTable(
  "attachment_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    slotId: text("slot_id").notNull(),
    blobId: uuid("blob_id").notNull(),
    previousBindingId: uuid("previous_binding_id"),
    attachmentEventHash: text("attachment_event_hash"),
    documentManifestHash: text("document_manifest_hash"),
    detachedAt: timestamp("detached_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("attachment_bindings_document_idx").on(table.documentId),
    index("attachment_bindings_blob_idx").on(table.blobId),
    index("attachment_bindings_previous_binding_id_idx").on(
      table.previousBindingId,
    ),
    index("attachment_bindings_attachment_event_hash_idx").on(
      table.attachmentEventHash,
    ),
    uniqueIndex("attachment_bindings_document_slot_active_idx")
      .on(table.documentId, table.slotId)
      .where(sql`${table.detachedAt} is null`),
  ],
);
