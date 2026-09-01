import type {
  BlobContentKeyTarget,
  ContentRecordEncryptionSuite,
  KeyingCanonicalJson,
  WriteHeader,
} from "@tearleads/crypto";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

export interface BlobWriteAuthorization {
  readonly activeBindingIds: readonly string[];
  readonly blobAccessManifestHash: string;
  readonly blobId: string;
  readonly blobKeyTargetHash: string;
  readonly documentManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly linkedContainerManifestHashes: readonly string[];
  readonly organizationId: string;
  readonly targets: readonly BlobContentKeyTarget[];
}

/**
 * Content-key epochs for encrypted blob payloads.
 *
 * A blob content-key bundle says which symmetric content key protects a blob
 * and which current attachment/container KEK targets can unwrap it. Blobs are
 * immutable in this model. Permission and KEK changes refresh the key-package
 * targets for the existing payload epoch; callers only replace the blob when the
 * encrypted bytes themselves change.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Target rows reference this id.
 *   Domain identity is `(blobId, contentKeyEpoch)`.
 * - `blobId`: Blob whose encrypted content key this bundle describes.
 * - `contentKeyEpoch`: Blob content-key epoch used by the encrypted payload.
 * - `targetHash`: Hash of the normalized target rows in
 *   `blobContentKeyTargets`.
 * - `createdAt`: Server-side insertion timestamp for the epoch row.
 * - `updatedAt`: Server-side timestamp for key-package refreshes, such as
 *   attachment target growth, target shrink, or container KEK rewrap.
 *
 * Indexes:
 * - `(blobId, contentKeyEpoch)` is unique because a blob can have one accepted
 *   bundle per epoch.
 * - `blobId` supports latest-bundle lookup by ordering epochs descending.
 * - `targetHash` supports target-hash based validation and diagnostics.
 */
export const blobContentKeyEpochs = pgTable(
  "blob_content_key_epochs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blobId: uuid("blob_id").notNull(),
    contentKeyEpoch: integer("content_key_epoch").notNull(),
    targetHash: text("target_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("blob_content_key_epochs_blob_epoch_idx").on(
      table.blobId,
      table.contentKeyEpoch,
    ),
    index("blob_content_key_epochs_blob_idx").on(table.blobId),
    index("blob_content_key_epochs_target_idx").on(table.targetHash),
  ],
);

/**
 * Recipient target envelopes for one blob content-key epoch.
 *
 * Each row stores the blob content key wrapped for one active attachment target:
 * a binding, the document that owns that binding, and one linked container KEK
 * reached through that document's current link-set manifest. The target fields
 * hash to the parent epoch row's `targetHash`; `wrappedKey` and
 * `wrappingMetadata` are encrypted material needed by clients.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(blobContentKeyEpochId, bindingId, documentId, containerId)`.
 * - `blobContentKeyEpochId`: Parent blob content-key epoch row.
 * - `bindingId`: Active attachment binding that makes this blob reachable.
 * - `documentId`: Document containing the attachment binding.
 * - `containerId`: Linked container recipient for this target.
 * - `containerManifestHash`: Current container access manifest hash used when
 *   deriving the target.
 * - `containerKeyEpochId`: Container KEK epoch id that wraps this blob content
 *   key.
 * - `containerKeyEpoch`: Numeric container KEK epoch corresponding to
 *   `containerKeyEpochId`.
 * - `wrappedKey`: Blob content key encrypted/wrapped for the container KEK.
 * - `wrappingMetadata`: Canonical metadata needed by the client to unwrap
 *   `wrappedKey`; current clients use suite
 *   `tearleads.blob.content-key-wrap.aes-256-gcm-container-kek` with an
 *   AES-GCM IV.
 * - `createdAt`: Server-side insertion timestamp for the target row.
 *
 * Indexes:
 * - `blobContentKeyEpochId` supports loading the full target set for an epoch.
 * - `bindingId` supports attachment-binding oriented fanout and diagnostics.
 * - `containerKeyEpochId` supports reverse lookups by container KEK material.
 * - `(blobContentKeyEpochId, bindingId, documentId, containerId)` is unique so
 *   an epoch has at most one envelope for each binding/document/container
 *   target.
 */
export const blobContentKeyTargets = pgTable(
  "blob_content_key_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blobContentKeyEpochId: uuid("blob_content_key_epoch_id")
      .notNull()
      .references(() => blobContentKeyEpochs.id),
    bindingId: uuid("binding_id").notNull(),
    documentId: uuid("document_id").notNull(),
    containerId: uuid("container_id").notNull(),
    containerManifestHash: text("container_manifest_hash").notNull(),
    containerKeyEpochId: text("container_key_epoch_id").notNull(),
    containerKeyEpoch: integer("container_key_epoch").notNull(),
    wrappedKey: text("wrapped_key").notNull(),
    wrappingMetadata: jsonb("wrapping_metadata")
      .$type<KeyingCanonicalJson>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("blob_content_key_targets_epoch_idx").on(table.blobContentKeyEpochId),
    index("blob_content_key_targets_binding_idx").on(table.bindingId),
    index("blob_content_key_targets_container_epoch_idx").on(
      table.containerKeyEpochId,
    ),
    uniqueIndex("blob_content_key_targets_epoch_binding_container_idx").on(
      table.blobContentKeyEpochId,
      table.bindingId,
      table.documentId,
      table.containerId,
    ),
  ],
);

/**
 * Verified write headers for encrypted blob payload records.
 *
 * Committed encrypted blob bytes live in `blobs`; this table stores the keying
 * write header that authorizes and describes those bytes. Blob writes currently
 * use content-key epoch `1` and store one header per blob record. Replays for
 * the same `recordId` are accepted only when `headerHash` matches.
 *
 * Columns:
 * - `recordId`: Primary key for the blob content record. Staged blob promotion
 *   uses the blob id as the record id.
 * - `blobId`: Blob whose encrypted payload this header describes.
 * - `organizationId`: Organization boundary from the verified header.
 * - `contentKeyEpoch`: Blob content-key epoch used for the payload.
 * - `accessManifestHash`: Blob access manifest hash verified for the write.
 * - `targetHash`: Blob content-key target hash verified for the write.
 * - `encryptionSuite`: Content-record encryption suite used by the client.
 * - `contentRecordId`: Client content record id inside the header. For blob
 *   payloads this is unique within `(blobId, contentKeyEpoch)`.
 * - `nonceDomainHash`: Nonce-domain commitment; uniqueness prevents nonce
 *   domain reuse within the same blob content-key epoch.
 * - `headerHash`: Hash of the canonical write header.
 * - `header`: Full canonical write header JSON.
 * - `authorization`: Exact verified blob KEK projection committed by the
 *   header when the write was accepted. Nullable only for legacy rows.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(blobId, contentKeyEpoch)` supports epoch-scoped blob lookup and
 *   diagnostics.
 * - `headerHash` is unique because it content-addresses the write header.
 * - `(blobId, contentKeyEpoch, contentRecordId)` prevents duplicate content
 *   record ids for an epoch.
 * - `(blobId, contentKeyEpoch, nonceDomainHash)` prevents nonce-domain reuse
 *   for an epoch.
 */
export const blobContentWriteHeaders = pgTable(
  "blob_content_write_headers",
  {
    recordId: uuid("record_id").primaryKey(),
    blobId: uuid("blob_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    contentKeyEpoch: integer("content_key_epoch").notNull(),
    accessManifestHash: text("access_manifest_hash").notNull(),
    targetHash: text("target_hash").notNull(),
    encryptionSuite: text("encryption_suite")
      .$type<ContentRecordEncryptionSuite>()
      .notNull(),
    contentRecordId: text("content_record_id").notNull(),
    nonceDomainHash: text("nonce_domain_hash").notNull(),
    headerHash: text("header_hash").notNull(),
    header: jsonb("header").$type<WriteHeader>().notNull(),
    authorization: jsonb("authorization").$type<BlobWriteAuthorization>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("blob_content_write_headers_blob_epoch_idx").on(
      table.blobId,
      table.contentKeyEpoch,
    ),
    index("blob_content_write_headers_organization_blob_idx").on(
      table.organizationId,
      table.blobId,
    ),
    uniqueIndex("blob_content_write_headers_header_hash_idx").on(
      table.headerHash,
    ),
    uniqueIndex("blob_content_write_headers_content_record_idx").on(
      table.blobId,
      table.contentKeyEpoch,
      table.contentRecordId,
    ),
    uniqueIndex("blob_content_write_headers_nonce_domain_idx").on(
      table.blobId,
      table.contentKeyEpoch,
      table.nonceDomainHash,
    ),
  ],
);
