import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  containerSQLiteSchema,
  containerTableSchemas,
} from "./containerSchema";
import {
  documentOrphanBlobReclaims,
  documentOrphanBlobReclaimTable,
} from "./documentOrphanBlobReclaims";
import {
  organizationDataUsageSQLiteSchema,
  organizationDataUsageTables,
} from "./organizationDataUsageSchema";
import {
  organizationReadModelSQLiteSchema,
  organizationReadModelTables,
} from "./organizationReadModelTableRegistry";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
} from "./principalPolicySchema";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

export {
  containerProjection,
  containers,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
} from "./containerSchema";
export {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
} from "./principalPolicySchema";
export { organizationReadModelTables };

const accessLevelColumn = "effective_access_level";

/**
 * Durable Loro-backed document records shared by app features.
 *
 * This table stores encrypted document runtime state for multiple app domains.
 * `appKind` namespaces records for documents and container metadata. User-facing
 * list data is projected into feature-specific read models.
 *
 * Columns:
 * - `appKind`: Local domain namespace for the row, such as `documents` or
 *   `container-metadata`.
 * - `localId`: Stable local id inside `appKind`. It may be created before a
 *   server `documentId` exists.
 * - `documentId`: Server document id once the record is known remotely, or
 *   `null` while the document is local-only.
 * - `accessEpoch`: Latest access epoch persisted for the document. Defaults to
 *   the initial epoch.
 * - `accessStateHash`: Current document access/manifest state hash returned by
 *   sync, when known.
 * - `lastCommitLsn`: Last remote commit cursor applied to this local document.
 * - `documentManifestBundle`: Serialized document manifest bundle used for
 *   encrypted document sync.
 * - `contentKeyBundle`: Serialized content-key material needed to open the
 *   local document.
 * - `documentKekTargets`: Serialized KEK target state for document key wraps.
 * - `pendingBaseVersion`: Encoded oplog version through which every persisted
 *   op is already enqueued or synced. Persisted so a restart restores the
 *   outgoing-delta marker instead of re-seeding it past a device-first
 *   `deferRemoteSync` write's un-advanced op. `null` when unset.
 * - `snapshotEndVersion`: Encoded end version vector of the persisted content
 *   (which lives in the durable-history tables, never on this row), written on
 *   every content persist. Lets the pending-write queue's deferred-tail scan
 *   compare version coverage without loading content. Empty string when the
 *   document has never hydrated content, which readers treat as "no deferred
 *   tail claimable".
 * - `updatedAt`: Local timestamp for the last persisted runtime-state update.
 *
 * Indexes:
 * - `(appKind, localId)` is the primary key and scopes local document lookups.
 * - `(appKind, documentId) where documentId is not null` supports resolving a
 *   server document id back to the local row during discovery and relinking.
 */
export const documents = sqliteTable(
  "documents",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id"),
    accessEpoch: integer("access_epoch").notNull().default(1),
    accessStateHash: text("access_state_hash"),
    effectiveAccessLevel: text(accessLevelColumn).notNull().default("read"),
    lastCommitLsn: text("last_commit_lsn"),
    documentManifestBundle: text("document_manifest_bundle"),
    contentKeyBundle: text("content_key_bundle"),
    documentKekTargets: text("document_kek_targets"),
    pendingBaseVersion: text("pending_base_version"),
    snapshotEndVersion: text("snapshot_end_version").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId] }),
    index("documents_app_document_idx")
      .on(table.appKind, table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

/**
 * Outbound Loro updates waiting to be accepted by sync.
 *
 * Each row stores one locally produced update for a document scope. The queue is
 * replayed in creation order and acknowledged rows are deleted after sync
 * writes the corresponding server commit or persisted document state.
 *
 * Columns:
 * - `id`: Client-generated queue id used for acknowledgement deletes.
 * - `appKind`: Local document namespace matching `documents.appKind`.
 * - `localId`: Local document id matching `documents.localId`.
 * - `updateData`: Serialized Loro update payload.
 * - `partialStartVersionVector`: Version vector before this partial update.
 * - `partialEndVersionVector`: Version vector after this partial update.
 * - `sourceVersionVector`: Optional source vector used to avoid re-enqueuing
 *   updates that came from sync.
 * - `createdAt`: Queue insertion timestamp used for deterministic replay.
 *
 * Indexes:
 * - `id` is the primary key for targeted deletes.
 * - `(appKind, localId, createdAt)` supports ordered pending-update scans for a
 *   document scope.
 */
export const documentPendingUpdates = sqliteTable(
  "document_pending_updates",
  {
    id: text("id"),
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    updateData: text("update_data").notNull(),
    partialStartVersionVector: text("partial_start_version_vector").notNull(),
    partialEndVersionVector: text("partial_end_version_vector").notNull(),
    sourceVersionVector: text("source_version_vector"),
    createdAt: text("created_at").notNull(),
    rekeyCount: integer("rekey_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_pending_updates_scope_created_idx").on(
      table.appKind,
      table.localId,
      table.createdAt,
    ),
  ],
);

/**
 * Last terminal outbound-sync failure per document scope.
 *
 * The durable write queue (`documentPendingUpdates`) has no status columns — a
 * row is either pending or settled-and-deleted. When a submission fails
 * terminally (e.g. the server denies the write with a 403 after group access
 * was revoked), the failure is recorded here so the write-queue view and the
 * footer sync indicator can surface *why* local data is not flushing. Rows are
 * upserted per scope on terminal failure and deleted when a later sync pass
 * for the scope succeeds or the scope's local state is torn down.
 *
 * Columns:
 * - `appKind`: Local document namespace matching `documents.appKind`.
 * - `localId`: Local document id matching `documents.localId`.
 * - `status`: HTTP status of the failed submission when known.
 * - `message`: Human-readable failure description for queue display.
 * - `attemptedAt`: Timestamp of the failed attempt.
 *
 * Indexes:
 * - `(appKind, localId)` is the primary key and keeps one failure per scope.
 */
export const documentSyncFailures = sqliteTable(
  "document_sync_failures",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    status: integer("status"),
    message: text("message").notNull(),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

/**
 * Full-history persistence for local documents (checkpoint + tail) — the ONLY
 * durable content source. Record rows in `documents` carry runtime metadata
 * and the content frontier (`snapshotEndVersion`), never content. The
 * checkpoint holds a full-history snapshot refreshed only at compaction, and
 * the tail appends every update (local deltas and decrypted remote updates)
 * written since. Restore = import checkpoint + replay tail; compaction =
 * export full history from the live doc, replace the checkpoint, clear the
 * tail — all bounded and amortized. Container metadata stores its content (an
 * exported-updates blob) as its checkpoint row, with no tail.
 */
export const documentHistoryCheckpoints = sqliteTable(
  "document_history_checkpoints",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    snapshot: text("snapshot").notNull(),
    endVersionVector: text("end_version_vector").notNull(),
    revision: text("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

export const documentHistoryUpdates = sqliteTable(
  "document_history_updates",
  {
    id: text("id"),
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    updateData: text("update_data").notNull(),
    // Provenance: "local" (authored on this device) or "remote" (decrypted
    // pulled update). Restores use it to advance the outgoing-delta marker
    // across remote rows — their ops are already server-side — while a local
    // row left behind by a crash stays below the marker so the next edit
    // re-derives and sends it. Added WITHOUT a migration under the greenfield
    // reset documented on the `documents` table above: no database predating
    // this column survives the reset, so every history table is created with
    // it.
    origin: text("origin").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_history_updates_scope_created_idx").on(
      table.appKind,
      table.localId,
      table.createdAt,
    ),
  ],
);

/**
 * Anti-rollback pin for verified access manifests.
 *
 * Records the highest access-manifest epoch this client has verified for each
 * object, so a later projection that serves an older epoch (rollback) or a
 * conflicting manifest at the same epoch (equivocation) is detected before any
 * key is unwrapped. Updated monotonically after a projection verifies cleanly.
 *
 * Columns:
 * - `objectKind`: Access object kind (`container`, `document`, ...).
 * - `organizationId`: Organization boundary that owns the object.
 * - `objectId`: Stable object id.
 * - `epoch`: Highest verified manifest epoch.
 * - `manifestHash`: Manifest hash pinned at that epoch.
 * - `updatedAt`: Local timestamp for the pin.
 *
 * Indexes:
 * - `(objectKind, organizationId, objectId)` is the primary key and gives one
 *   pin per object.
 */
export const accessManifestCheckpoints = sqliteTable(
  "access_manifest_checkpoints",
  {
    objectKind: text("object_kind").notNull(),
    organizationId: text("organization_id").notNull(),
    objectId: text("object_id").notNull(),
    epoch: integer("epoch").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.objectKind, table.organizationId, table.objectId],
    }),
  ],
);

/**
 * Durable trust-on-first-use pins for remote user identity bundles.
 *
 * The first validated identity observed for a user in a configured API trust
 * domain is inserted once. Later observations must match every suite, public
 * key, and fingerprint exactly; the persistence adapter never updates these
 * rows. `firstSeenAt` records when the local trust decision was made and is
 * likewise immutable.
 *
 * Indexes:
 * - `(identityTrustDomain, userId)` is the primary key and scopes a user pin to
 *   the host-configured API authority that supplied it.
 */
export const trustedUserIdentityPins = sqliteTable(
  "trusted_user_identity_pins",
  {
    identityTrustDomain: text("identity_trust_domain").notNull(),
    userId: text("user_id").notNull(),
    formatVersion: integer("format_version").notNull(),
    signingSuite: text("signing_suite").notNull(),
    signingPublicKey: text("signing_public_key").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
    encapsulationSuite: text("encapsulation_suite").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    encapsulationKeyFingerprint: text(
      "encapsulation_key_fingerprint",
    ).notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identityTrustDomain, table.userId],
    }),
  ],
);

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
 */
export const documentContainerProjection = sqliteTable(
  "document_container_projection",
  {
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.containerId] })],
);

/**
 * Device-first document moves waiting for remote link-set replay.
 *
 * A document move is applied to local projections immediately, then replayed as
 * remote link/unlink mutations when writer context is available. Replays are
 * rebuilt from current writer projections so the queue stores only intent.
 *
 * Columns:
 * - `id`: Client-generated intent id.
 * - `localId`: Local document row to update after replay.
 * - `documentId`: Server document id whose link set should move.
 * - `targetContainerId`: Desired active/final container id.
 * - `sourceContainerId`: Original active container to unlink for move-style
 *   intents. Replace-style intents unlink every remote container except target.
 * - `replaceLinkedContainers`: Whether the final remote link set should be
 *   only the target container.
 * - `intentType`: Intent discriminator, currently `document.move`.
 * - `syncStatus`: Current sync state, currently `pending` or `blocked`.
 * - `lastError`: Last sync error message for retry/debug display.
 * - `lastAttemptedAt`: Timestamp of the last replay attempt.
 * - `createdAt`: Intent creation timestamp used for FIFO sync.
 * - `updatedAt`: Local timestamp for the latest target/status/error change.
 *
 * Indexes:
 * - `id` is the primary key.
 * - `documentId` is unique so same-document moves coalesce to one intent.
 * - `(syncStatus, createdAt)` supports listing pending intents in queue order.
 */
export const documentMoveIntents = sqliteTable(
  "document_move_intents",
  {
    id: text("id"),
    localId: text("local_id").notNull(),
    documentId: text("document_id").notNull().unique(),
    targetContainerId: text("target_container_id").notNull(),
    sourceContainerId: text("source_container_id"),
    replaceLinkedContainers: integer("replace_linked_containers", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    intentType: text("intent_type").notNull(),
    syncStatus: text("sync_status").notNull(),
    lastError: text("last_error"),
    lastAttemptedAt: text("last_attempted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_move_intents_status_created_idx").on(
      table.syncStatus,
      table.createdAt,
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

/**
 * Offline create queue for containers.
 *
 * A user can create a local container before the API has assigned all remote
 * state for the container and its metadata document. This table keeps the sync
 * intent until container-create sync either records the remote ids or stores an
 * error for retry.
 *
 * Columns:
 * - `id`: Client-generated intent id.
 * - `containerId`: Local container id created optimistically.
 * - `parentContainerId`: Parent container id used when the intent is sent.
 * - `intentType`: Intent discriminator, currently `container.create`.
 * - `syncStatus`: Current sync state, currently `pending` or `synced`.
 * - `remoteContainerId`: Remote container id recorded after successful sync.
 * - `remoteMetadataDocumentId`: Remote metadata document id recorded after
 *   successful sync.
 * - `remoteMetadataAccessStateHash`: Access state hash for the synced metadata
 *   document.
 * - `lastError`: Last sync error message for retry/debug display.
 * - `createdAt`: Intent creation timestamp used for FIFO sync.
 * - `updatedAt`: Local timestamp for the latest status/error change.
 *
 * Indexes:
 * - `id` is the primary key.
 * - `containerId` is unique so each local container has one create intent.
 * - `(syncStatus, createdAt)` supports listing pending intents in creation
 *   order.
 */
export const containerCreateIntents = sqliteTable(
  "container_create_intents",
  {
    id: text("id"),
    containerId: text("container_id").notNull().unique(),
    parentContainerId: text("parent_container_id").notNull(),
    intentType: text("intent_type").notNull(),
    syncStatus: text("sync_status").notNull(),
    remoteContainerId: text("remote_container_id"),
    remoteMetadataDocumentId: text("remote_metadata_document_id"),
    remoteMetadataAccessStateHash: text("remote_metadata_access_state_hash"),
    lastError: text("last_error"),
    // Added WITHOUT a migration under the greenfield reset documented on the
    // `documents` table: no database predating this column survives it.
    lastAttemptedAt: text("last_attempted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("container_create_intents_status_created_idx").on(
      table.syncStatus,
      table.createdAt,
    ),
  ],
);

/**
 * Offline move queue for synced containers.
 *
 * A user can move a container whose server identity is already known while the
 * API or writer context is unavailable. This table stores only the desired
 * final parent and replay diagnostics; the signed move request is rebuilt from
 * current writer projections when sync resumes.
 *
 * Columns:
 * - `id`: Client-generated intent id.
 * - `containerId`: Synced container moved optimistically in the local tree.
 * - `parentContainerId`: Desired final parent container id.
 * - `previousParentContainerId`: Parent observed when the move was queued.
 * - `intentType`: Intent discriminator, currently `container.move`.
 * - `syncStatus`: Current sync state, currently `pending` or `blocked`.
 * - `lastError`: Last sync error message for retry/debug display.
 * - `lastAttemptedAt`: Timestamp of the last replay attempt.
 * - `createdAt`: Intent creation timestamp used for FIFO sync.
 * - `updatedAt`: Local timestamp for the latest target/status/error change.
 *
 * Indexes:
 * - `id` is the primary key.
 * - `containerId` is unique so same-container moves coalesce to one intent.
 * - `(syncStatus, createdAt)` supports listing pending intents in queue order.
 */
export const containerMoveIntents = sqliteTable(
  "container_move_intents",
  {
    id: text("id"),
    containerId: text("container_id").notNull().unique(),
    parentContainerId: text("parent_container_id").notNull(),
    previousParentContainerId: text("previous_parent_container_id"),
    intentType: text("intent_type").notNull(),
    syncStatus: text("sync_status").notNull(),
    lastError: text("last_error"),
    lastAttemptedAt: text("last_attempted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("container_move_intents_status_created_idx").on(
      table.syncStatus,
      table.createdAt,
    ),
  ],
);

/**
 * Per-lane sync cursors for container data.
 *
 * Container sync is split into lanes, such as a parent-container child lane or
 * a container-document membership lane. This table stores the last accepted
 * server watermark for each lane so the next sync request can resume without
 * replaying the entire tree.
 *
 * Columns:
 * - `laneKind`: Sync lane category, such as `container_parent` or
 *   `container_documents`.
 * - `laneId`: Lane identity. Root parent sync uses `root`, child sync uses a
 *   parent-prefixed container id, and document lanes use the container id.
 * - `watermarkUpdatedAt`: Server `updatedAt` value for the stored watermark.
 * - `watermarkId`: Server id tie-breaker for the stored watermark.
 * - `updatedAt`: Local timestamp for when the cursor was saved.
 *
 * Indexes:
 * - `(laneKind, laneId)` is the primary key and stores one cursor per lane.
 */
export const containerSyncWatermarks = sqliteTable(
  "container_sync_watermarks",
  {
    laneKind: text("lane_kind").notNull(),
    laneId: text("lane_id").notNull(),
    watermarkUpdatedAt: text("watermark_updated_at").notNull(),
    watermarkId: text("watermark_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

/**
 * Local freshness markers for container sync lanes.
 *
 * These rows track the last successful API check for a lane independently from
 * server watermarks. Empty server responses do not always include a new
 * watermark, but the client still needs to remember that it recently checked
 * the lane so startup can use cached container state without polling every
 * time a container tree opens.
 *
 * Columns:
 * - `laneKind`: Sync lane category matching `containerSyncWatermarks`.
 * - `laneId`: Lane identity matching `containerSyncWatermarks`.
 * - `checkedAt`: Local timestamp for the most recent successful lane check.
 *
 * Indexes:
 * - `(laneKind, laneId)` is the primary key and stores one marker per lane.
 */
export const containerSyncLaneChecks = sqliteTable(
  "container_sync_lane_checks",
  {
    laneKind: text("lane_kind").notNull(),
    laneId: text("lane_id").notNull(),
    checkedAt: text("checked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

export const documentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documents),
  defineSqlTableSchema(documentPendingUpdates),
  defineSqlTableSchema(documentSyncFailures),
  defineSqlTableSchema(documentHistoryCheckpoints),
  defineSqlTableSchema(documentHistoryUpdates),
];

export const principalPolicyTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(principalPolicies),
  defineSqlTableSchema(principalPolicyBundleHistory),
  defineSqlTableSchema(principalPolicyBundleReferences),
];

export const keyingCheckpointTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(accessManifestCheckpoints),
  defineSqlTableSchema(principalPolicyCheckpoints),
];

export const trustedUserIdentityPinTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(trustedUserIdentityPins),
];

export const containerTables = containerTableSchemas;

export const documentContainerProjectionTables: ReadonlyArray<SqlTableSchema> =
  [defineSqlTableSchema(documentContainerProjection)];

export const documentMoveIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentMoveIntents),
];

export const documentProjectionTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentProjection),
  defineSqlTableSchema(documentProjectionText),
  defineSqlTableSchema(documentPendingAttachments),
  defineSqlTableSchema(documentAttachmentBlobProjection),
  documentOrphanBlobReclaimTable,
];

export const containerCreateIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containerCreateIntents),
];

export const containerMoveIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containerMoveIntents),
];

export const containerSyncWatermarkTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containerSyncWatermarks),
  defineSqlTableSchema(containerSyncLaneChecks),
];

export const clientSqlTables: ReadonlyArray<SqlTableSchema> = [
  ...documentTables,
  ...principalPolicyTables,
  ...keyingCheckpointTables,
  ...trustedUserIdentityPinTables,
  ...containerTables,
  ...documentContainerProjectionTables,
  ...documentMoveIntentTables,
  ...documentProjectionTables,
  ...containerCreateIntentTables,
  ...containerMoveIntentTables,
  ...containerSyncWatermarkTables,
  ...organizationReadModelTables,
  ...organizationDataUsageTables,
];

export const clientSQLiteSchema = {
  documents,
  documentPendingUpdates,
  documentSyncFailures,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  accessManifestCheckpoints,
  principalPolicyCheckpoints,
  trustedUserIdentityPins,
  ...containerSQLiteSchema,
  documentContainerProjection,
  documentMoveIntents,
  documentProjection,
  documentPendingAttachments,
  documentAttachmentBlobProjection,
  documentOrphanBlobReclaims: documentOrphanBlobReclaims,
  containerCreateIntents,
  containerMoveIntents,
  containerSyncLaneChecks,
  containerSyncWatermarks,
  ...organizationReadModelSQLiteSchema,
  ...organizationDataUsageSQLiteSchema,
};
