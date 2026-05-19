import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "./sqlTableSchema";

/**
 * Durable Loro-backed document records shared by app features.
 *
 * This table stores the encrypted document runtime state for multiple local app
 * domains. `appKind` namespaces records for notes, contacts, and container
 * metadata so the same persistence helpers can manage all Loro documents.
 * User-facing list data is projected into feature-specific read models such as
 * `documentProjection`, `containerProjection`, and `addressBookProjection`.
 *
 * Columns:
 * - `appKind`: Local domain namespace for the row, such as `documents`,
 *   `contacts`, or `container-metadata`.
 * - `localId`: Stable local id inside `appKind`. It may be created before a
 *   server `documentId` exists.
 * - `documentId`: Server document id once the record is known remotely, or
 *   `null` while the document is local-only.
 * - `loroSnapshot`: Serialized Loro document snapshot.
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
    loroSnapshot: text("loro_snapshot").notNull(),
    accessEpoch: integer("access_epoch").notNull().default(1),
    accessStateHash: text("access_state_hash"),
    lastCommitLsn: text("last_commit_lsn"),
    documentManifestBundle: text("document_manifest_bundle"),
    contentKeyBundle: text("content_key_bundle"),
    documentKekTargets: text("document_kek_targets"),
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
 * Local cache of managed-principal policy bundles.
 *
 * Principal policy bundles are fetched from the API after verification and kept
 * locally so access decisions and projection verification can run offline. The
 * JSON columns intentionally mirror the wire bundle shape rather than
 * normalizing membership rows in the app database.
 *
 * Columns:
 * - `principalType`: Managed principal kind, currently `organization` or
 *   `group`.
 * - `principalId`: Stable id of the organization/group principal.
 * - `stateHash`: Current signed principal-state hash.
 * - `currentStateJson`: Serialized current principal state header.
 * - `currentPayloadJson`: Serialized encrypted/current policy payload.
 * - `currentProjectionJson`: Serialized current membership projection.
 * - `currentMemberEnvelopesJson`: Serialized member key-envelope records.
 * - `previousStatesJson`: Serialized historical states included with the
 *   bundle.
 * - `updatedAt`: Local timestamp for the cached bundle.
 *
 * Indexes:
 * - `(principalType, principalId)` is the primary key and gives one current
 *   bundle per managed principal.
 */
export const principalPolicies = sqliteTable(
  "principal_policies",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    currentStateJson: text("current_state_json").notNull(),
    currentPayloadJson: text("current_payload_json").notNull(),
    currentProjectionJson: text("current_projection_json").notNull(),
    currentMemberEnvelopesJson: text("current_member_envelopes_json").notNull(),
    previousStatesJson: text("previous_states_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
  ],
);

/**
 * Materialized local container tree.
 *
 * Container rows describe the structural explorer tree and the document that
 * stores encrypted container metadata. Display fields are kept in
 * `containerProjection`; the Loro metadata document itself is stored in
 * `documents` under the container-metadata app kind.
 *
 * Columns:
 * - `id`: Stable local/server container id.
 * - `organizationId`: Organization boundary that owns the container.
 * - `parentId`: Parent container id, or `null` for a root container.
 * - `metadataDocumentId`: Server document id for the container metadata
 *   document when known.
 * - `localCreatedAt`: Timestamp for when this client first created or stored
 *   the container.
 * - `localUpdatedAt`: Timestamp for the latest local structural change.
 * - `serverCreatedAt`: Server creation timestamp when the container has synced.
 * - `serverUpdatedAt`: Server update timestamp when the container has synced.
 *
 * Indexes:
 * - `id` is the primary key for structural container lookups.
 */
export const containers = sqliteTable(
  "containers",
  {
    id: text("id"),
    organizationId: text("organization_id").notNull(),
    parentId: text("parent_id"),
    metadataDocumentId: text("metadata_document_id"),
    localCreatedAt: text("local_created_at").notNull(),
    localUpdatedAt: text("local_updated_at").notNull(),
    serverCreatedAt: text("server_created_at"),
    serverUpdatedAt: text("server_updated_at"),
  },
  (table) => [primaryKey({ columns: [table.id] })],
);

/**
 * Decrypted container metadata read model.
 *
 * Container metadata is authored as a Loro document, but explorer lists need a
 * small queryable projection for names and icons. This table is updated
 * together with `containers` when local metadata changes or sync applies remote
 * metadata.
 *
 * Columns:
 * - `containerId`: Container whose metadata is projected.
 * - `displayName`: Decrypted display name, or `null` when the UI should fall
 *   back to a default such as `/` or `Untitled`.
 * - `icon`: Optional decrypted icon value for explorer display.
 * - `updatedAt`: Local timestamp for the projection update.
 *
 * Indexes:
 * - `containerId` is the primary key and joins back to `containers.id`.
 */
export const containerProjection = sqliteTable(
  "container_projection",
  {
    containerId: text("container_id"),
    displayName: text("display_name"),
    icon: text("icon"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.containerId] })],
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
 * - `documentKind`: Stored document kind. Defaults to `note`.
 * - `text`: Plain projected text used to rebuild summaries/details.
 * - `title`: Plain projected title. Defaults to the note fallback title.
 * - `updatedAt`: Timestamp used for document list ordering.
 *
 * Indexes:
 * - `localId` is the primary key for document projection lookups.
 */
export const documentProjection = sqliteTable(
  "document_projection",
  {
    localId: text("local_id"),
    documentId: text("document_id"),
    containerId: text("container_id"),
    documentKind: text("document_kind").notNull().default("note"),
    text: text("text").notNull(),
    title: text("title").notNull().default("Untitled note"),
    updatedAt: text("updated_at").notNull(),
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
  },
  (table) => [primaryKey({ columns: [table.localId, table.slotId] })],
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
 *
 * Indexes:
 * - `(localId, slotId)` is the primary key and keeps one projected blob per
 *   document attachment slot.
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
  },
  (table) => [primaryKey({ columns: [table.localId, table.slotId] })],
);

/**
 * Address-book contact read model.
 *
 * Contact details are stored as Loro documents under the contacts app kind.
 * This projection keeps the fields needed for address-book lists, self-contact
 * lookup, and user-recipient targeting without opening every contact document.
 *
 * Columns:
 * - `addressBookId`: Local address book document/principal that owns the
 *   contact list.
 * - `contactId`: Local contact document id.
 * - `firstName`: Projected first name used for sorting and display.
 * - `lastName`: Projected last name used for sorting and display.
 * - `userId`: Server user id when the contact is linked to a registered user.
 * - `encapsulationPublicKey`: User recipient public key copied from contact
 *   data when available.
 * - `isSelf`: Integer boolean marking the current user's own contact row.
 * - `updatedAt`: Local timestamp for the projection update.
 *
 * Indexes:
 * - `(addressBookId, contactId)` is the primary key.
 * - `addressBookId where isSelf = 1` is unique so each address book has at most
 *   one self contact.
 * - `(addressBookId, userId) where userId is not null` is unique so a remote
 *   user appears once per address book.
 */
export const addressBookProjection = sqliteTable(
  "address_book_projection",
  {
    addressBookId: text("address_book_id").notNull(),
    contactId: text("contact_id").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    userId: text("user_id"),
    encapsulationPublicKey: text("encapsulation_public_key"),
    isSelf: integer("is_self").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.addressBookId, table.contactId] }),
    uniqueIndex("address_book_projection_self_idx")
      .on(table.addressBookId)
      .where(sql`${table.isSelf} = 1`),
    uniqueIndex("address_book_projection_user_idx")
      .on(table.addressBookId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  ],
);

/**
 * Offline create queue for explorer containers.
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
 * Per-lane sync cursors for container explorer data.
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

export const documentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documents),
  defineSqlTableSchema(documentPendingUpdates),
];

export const principalPolicyTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(principalPolicies),
];

export const containerTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containers),
  defineSqlTableSchema(containerProjection),
];

export const documentContainerProjectionTables: ReadonlyArray<SqlTableSchema> =
  [defineSqlTableSchema(documentContainerProjection)];

export const documentProjectionTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentProjection),
  defineSqlTableSchema(documentPendingAttachments),
  defineSqlTableSchema(documentAttachmentBlobProjection),
];

export const addressBookProjectionTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(addressBookProjection),
];

export const containerCreateIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containerCreateIntents),
];

export const containerSyncWatermarkTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(containerSyncWatermarks),
];

export const appSqlTables: ReadonlyArray<SqlTableSchema> = [
  ...documentTables,
  ...principalPolicyTables,
  ...containerTables,
  ...documentContainerProjectionTables,
  ...documentProjectionTables,
  ...addressBookProjectionTables,
  ...containerCreateIntentTables,
  ...containerSyncWatermarkTables,
];

export const appSQLiteSchema = {
  documents,
  documentPendingUpdates,
  principalPolicies,
  containers,
  containerProjection,
  documentContainerProjection,
  documentProjection,
  documentPendingAttachments,
  documentAttachmentBlobProjection,
  addressBookProjection,
  containerCreateIntents,
  containerSyncWatermarks,
};
