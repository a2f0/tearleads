import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";
import type {
  BlobAuditRetentionMode,
  DocumentAttachmentAuditAction,
} from "./shared";

/**
 * Hash-chained checkpoint records for document audit history.
 *
 * Document update sync can mark selected Loro updates as checkpoints. A
 * checkpoint records the baseline update id, source version vector, the latest
 * covered audit entry hash, the previous checkpoint hash, and the access state
 * under which the checkpoint was written. The computed `checkpointHash` chains
 * those fields for later audit-history verification.
 *
 * Columns:
 * - `id`: Surrogate unique identifier for the checkpoint row.
 * - `documentId`: Document whose audit checkpoint this row describes.
 * - `sequence`: Engine-generated monotonic sequence and table primary key,
 *   used to order checkpoints. Queries scope the ordering by `documentId`.
 * - `baselineUpdateId`: Live document update id that carries the checkpoint
 *   baseline. Unique so the same update cannot create multiple checkpoints.
 * - `checkpointKind`: Loro checkpoint kind supplied by the update metadata.
 * - `sourceVersionVector`: Loro source version vector covered by the
 *   checkpoint.
 * - `coveredAuditEntryHash`: Latest document audit entry hash covered by this
 *   checkpoint, or `null` when no entry was covered.
 * - `previousCheckpointHash`: Previous checkpoint hash for the document, or
 *   `null` for the first checkpoint.
 * - `checkpointHash`: Hash over the checkpoint fields and previous checkpoint
 *   pointer.
 * - `accessEpoch`: Access manifest epoch active when the checkpoint was
 *   written.
 * - `accessManifestHash`: Access manifest hash active when the checkpoint was
 *   written.
 * - `accessStateHash`: Optional object-specific access state hash included in
 *   the checkpoint hash when present.
 * - `actorUserId`: User who wrote the checkpoint update.
 * - `actorFingerprint`: Signing key fingerprint for `actorUserId`.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(documentId, sequence)` supports ordered checkpoint verification.
 * - `(documentId, checkpointHash)` is unique so one document cannot store
 *   conflicting rows for the same checkpoint hash.
 * - `(documentId, createdAt)` supports time-oriented audit lookup.
 */
export const documentAuditCheckpoints = pgTable(
  "document_audit_checkpoints",
  {
    id: uuid("id").defaultRandom().notNull().unique(),
    documentId: uuid("document_id").notNull(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    baselineUpdateId: uuid("baseline_update_id").notNull().unique(),
    checkpointKind: text("checkpoint_kind").notNull(),
    sourceVersionVector: text("source_version_vector").notNull(),
    coveredAuditEntryHash: text("covered_audit_entry_hash"),
    previousCheckpointHash: text("previous_checkpoint_hash"),
    checkpointHash: text("checkpoint_hash").notNull(),
    accessEpoch: integer("access_epoch").notNull(),
    accessManifestHash: text("access_manifest_hash").notNull(),
    accessStateHash: text("access_state_hash"),
    actorUserId: uuid("actor_user_id").notNull(),
    actorFingerprint: text("actor_fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("document_audit_checkpoints_document_sequence_idx").on(
      table.documentId,
      table.sequence,
    ),
    uniqueIndex("document_audit_checkpoints_document_hash_idx").on(
      table.documentId,
      table.checkpointHash,
    ),
    index("document_audit_checkpoints_document_created_idx").on(
      table.documentId,
      table.createdAt,
    ),
  ],
);

/**
 * Hash-chained document audit entries.
 *
 * This table stores the common audit envelope for auditable document actions.
 * Event-specific details live in companion tables such as
 * `documentUpdateAuditEvents` and `documentAttachmentAuditEvents`. The
 * `entryHash` commits the common fields, the event-specific fields, and the
 * previous entry hash so verifiers can replay the document's audit chain.
 *
 * Columns:
 * - `id`: Surrogate unique identifier. Companion event tables reference this id
 *   as their own primary key.
 * - `documentId`: Document whose audit history this row belongs to.
 * - `sequence`: Engine-generated monotonic sequence and table primary key, used
 *   to order entries. Queries scope the ordering by `documentId`.
 * - `eventType`: Audit event family, for example `loro_update` or
 *   `attachment_event`.
 * - `accessEpoch`: Access manifest epoch active when the event was written.
 * - `accessManifestHash`: Access manifest hash active when the event was
 *   written.
 * - `accessStateHash`: Optional object-specific access state hash included in
 *   the entry hash when present.
 * - `actorUserId`: User who performed the audited action.
 * - `actorFingerprint`: Signing key fingerprint for `actorUserId`.
 * - `prevEntryHash`: Previous audit entry hash for the document, or `null` for
 *   the first entry.
 * - `entryHash`: Hash over the common fields, event-specific fields, and
 *   previous entry pointer.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(documentId, sequence)` is unique and supports ordered audit replay.
 * - `(documentId, entryHash)` is unique so a document stores one row per audit
 *   hash.
 * - `(documentId, createdAt)` supports time-oriented audit lookup.
 */
export const documentAuditEntries = pgTable(
  "document_audit_entries",
  {
    id: uuid("id").defaultRandom().notNull().unique(),
    documentId: uuid("document_id").notNull(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    eventType: text("event_type").notNull(),
    accessEpoch: integer("access_epoch").notNull(),
    accessManifestHash: text("access_manifest_hash").notNull(),
    accessStateHash: text("access_state_hash"),
    actorUserId: uuid("actor_user_id").notNull(),
    actorFingerprint: text("actor_fingerprint").notNull(),
    prevEntryHash: text("prev_entry_hash"),
    entryHash: text("entry_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_audit_entries_document_sequence_idx").on(
      table.documentId,
      table.sequence,
    ),
    uniqueIndex("document_audit_entries_document_hash_idx").on(
      table.documentId,
      table.entryHash,
    ),
    index("document_audit_entries_document_created_idx").on(
      table.documentId,
      table.createdAt,
    ),
  ],
);

/**
 * Event-specific audit details for encrypted document updates.
 *
 * The common audit envelope lives in `documentAuditEntries` with event type
 * `loro_update`. This table adds the live update id, Loro version-vector
 * boundaries, and ciphertext digest metadata needed to verify the update audit
 * hash and correlate audit history with stored document updates.
 *
 * Columns:
 * - `auditEntryId`: Primary key and foreign key to the common audit entry.
 * - `liveUpdateId`: Id of the live document update row. Unique so one update is
 *   audited once.
 * - `partialStartVersionVector`: Loro version vector before applying the
 *   partial update.
 * - `partialEndVersionVector`: Loro version vector after applying the partial
 *   update.
 * - `sourceVersionVector`: Optional source version vector supplied by the
 *   client.
 * - `plaintextHash`: Domain-separated, record-key-derived HMAC of the decrypted
 *   Loro update bytes committed by the signed document write metadata.
 * - `encryptedUpdateSha256`: SHA-256 digest of the encrypted update payload.
 * - `encryptedUpdateByteLength`: Byte length of the encrypted update payload.
 */
export const documentUpdateAuditEvents = pgTable(
  "document_update_audit_events",
  {
    auditEntryId: uuid("audit_entry_id")
      .primaryKey()
      .references(() => documentAuditEntries.id),
    liveUpdateId: uuid("live_update_id").notNull().unique(),
    partialStartVersionVector: text("partial_start_version_vector").notNull(),
    partialEndVersionVector: text("partial_end_version_vector").notNull(),
    sourceVersionVector: text("source_version_vector"),
    plaintextHash: text("plaintext_hash").notNull(),
    encryptedUpdateSha256: text("encrypted_update_sha256").notNull(),
    encryptedUpdateByteLength: integer(
      "encrypted_update_byte_length",
    ).notNull(),
  },
);

/**
 * Blob metadata retained for document attachment audit history.
 *
 * Attachment audit entries may need to reference blobs after the live blob
 * lifecycle changes. This table stores immutable content metadata plus mutable
 * retention state for each referenced blob: digest, byte length, the storage
 * key while physical deletion is pending, and pruning/deletion timestamps.
 *
 * Columns:
 * - `blobId`: Primary key matching the committed blob id.
 * - `organizationId`: Organization that owns this blob generation. Retained
 *   after pruning so historical ids cannot become cross-organization probes.
 * - `sha256`: SHA-256 digest of the encrypted blob bytes.
 * - `byteLength`: Byte length of the encrypted blob bytes.
 * - `liveStorageKey`: Storage key for the live blob object when available.
 * - `retentionMode`: Retention policy for the audited blob metadata. Currently
 *   only `live_only` is supported.
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
    index("blob_audit_objects_pending_delete_idx")
      .on(table.objectDeleteAttemptedAt, table.prunedAt, table.blobId)
      .where(
        sql`${table.prunedAt} is not null and ${table.objectDeletedAt} is null and ${table.liveStorageKey} is not null`,
      ),
  ],
);

/**
 * Event-specific audit details for document attachment changes.
 *
 * The common audit envelope lives in `documentAuditEntries` with event type
 * `attachment_event`. This table adds the attachment slot, binding/blob ids,
 * prior binding/blob ids for replacements or detaches, and the blob retention
 * mode committed into the audit hash.
 *
 * Columns:
 * - `auditEntryId`: Primary key and foreign key to the common audit entry.
 * - `action`: Attachment action, currently `attach`, `replace`, `detach`, or
 *   `rewrap`.
 * - `slotId`: Logical attachment slot within the document.
 * - `bindingId`: New/current attachment binding id, when the action creates or
 *   references one.
 * - `previousBindingId`: Previous binding id for replacement or detach flows.
 * - `blobId`: New/current blob id for attach or replace flows.
 * - `previousBlobId`: Previous blob id for replacement or detach flows.
 * - `retentionMode`: Blob audit retention mode committed into the entry hash.
 */
export const documentAttachmentAuditEvents = pgTable(
  "document_attachment_audit_events",
  {
    auditEntryId: uuid("audit_entry_id")
      .primaryKey()
      .references(() => documentAuditEntries.id),
    action: text("action").$type<DocumentAttachmentAuditAction>().notNull(),
    slotId: text("slot_id").notNull(),
    bindingId: uuid("binding_id"),
    previousBindingId: uuid("previous_binding_id"),
    blobId: uuid("blob_id"),
    previousBlobId: uuid("previous_blob_id"),
    retentionMode: text("retention_mode")
      .$type<BlobAuditRetentionMode>()
      .notNull(),
  },
);
