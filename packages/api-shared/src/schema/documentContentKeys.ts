import type {
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

/**
 * Content-key epochs for encrypted document update payloads.
 *
 * A document content-key bundle says which symmetric content key epoch writers
 * should use for document updates, and which current container KEK targets can
 * unwrap that content key. The epoch row stores the bundle-level metadata:
 * document id, content-key epoch, the document link-set manifest that authorized
 * the target set, and the hash of the target set.
 *
 * Content-key epochs are monotonic per document. The latest epoch can be
 * refreshed when the same key material is still current, including additive
 * target growth or same-epoch manifest refreshes. If the current target set
 * shrinks, callers must rotate to a new content-key epoch so removed recipients
 * cannot keep using the old document content key.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Target rows reference this id.
 *   Domain identity is `(documentId, contentKeyEpoch)`.
 * - `documentId`: Stable id of the document whose encrypted update content key
 *   this bundle describes.
 * - `contentKeyEpoch`: Positive integer document content-key epoch. Write
 *   headers for document updates include this value.
 * - `linkSetManifestHash`: Current document link-set manifest hash that was
 *   validated when this bundle was stored. It binds the content key to the
 *   document's current linked-container state.
 * - `targetHash`: Hash of the normalized target rows in
 *   `documentContentKeyTargets`. Write headers include this hash so ciphertexts
 *   are bound to the exact recipient target set.
 * - `createdAt`: Server-side insertion timestamp for the epoch row.
 * - `updatedAt`: Server-side timestamp for metadata refreshes, such as
 *   same-epoch target growth or link-set manifest refresh.
 *
 * Indexes:
 * - `(documentId, contentKeyEpoch)` is unique because a document can have only
 *   one accepted bundle for an epoch.
 * - `documentId` supports latest-bundle lookup by ordering epochs descending.
 * - `targetHash` supports target-hash based validation and diagnostics.
 */
export const documentContentKeyEpochs = pgTable(
  "document_content_key_epochs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    contentKeyEpoch: integer("content_key_epoch").notNull(),
    linkSetManifestHash: text("link_set_manifest_hash").notNull(),
    targetHash: text("target_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_content_key_epochs_document_epoch_idx").on(
      table.documentId,
      table.contentKeyEpoch,
    ),
    index("document_content_key_epochs_document_idx").on(table.documentId),
    index("document_content_key_epochs_target_idx").on(table.targetHash),
  ],
);

/**
 * Recipient target envelopes for one document content-key epoch.
 *
 * Each row stores the document content key wrapped for one linked container's
 * current container KEK. The target fields are validated against the current
 * document KEK targets derived from the signed document link-set manifest and
 * current linked container manifests. The set of target fields hashes to the
 * parent epoch row's `targetHash`; `wrappedKey` and `wrappingMetadata` are the
 * encrypted material needed by clients to open the document content key.
 *
 * The table stores one target per linked container for each content-key epoch.
 * Same-epoch refreshes may update an existing container target when the
 * container manifest advances without changing the underlying key material, or
 * insert newly added containers when target growth is additive.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(documentContentKeyEpochId, containerId)`.
 * - `documentContentKeyEpochId`: Parent content-key epoch row. This scopes the
 *   target to one document and content-key epoch.
 * - `containerId`: Linked container recipient for this target.
 * - `containerManifestHash`: Current container access manifest hash used when
 *   deriving the target.
 * - `containerKeyEpochId`: Container KEK epoch id that wraps this document
 *   content key.
 * - `containerKeyEpoch`: Numeric container KEK epoch corresponding to
 *   `containerKeyEpochId`.
 * - `wrappedKey`: Document content key encrypted/wrapped for the container KEK.
 * - `wrappingMetadata`: Canonical metadata needed by the client to unwrap
 *   `wrappedKey`; current clients use suite
 *   `tearleads.document.content-key-wrap.aes-256-gcm-container-kek` with an
 *   AES-GCM IV.
 * - `createdAt`: Server-side insertion timestamp for the target row.
 *
 * Indexes:
 * - `documentContentKeyEpochId` supports loading the full target set for an
 *   epoch.
 * - `containerKeyEpochId` supports reverse lookups by container KEK material.
 * - `(documentContentKeyEpochId, containerId)` is unique so an epoch has at
 *   most one target envelope per linked container.
 */
export const documentContentKeyTargets = pgTable(
  "document_content_key_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentContentKeyEpochId: uuid("document_content_key_epoch_id")
      .notNull()
      .references(() => documentContentKeyEpochs.id),
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
    index("document_content_key_targets_epoch_idx").on(
      table.documentContentKeyEpochId,
    ),
    index("document_content_key_targets_container_epoch_idx").on(
      table.containerKeyEpochId,
    ),
    uniqueIndex("document_content_key_targets_epoch_container_idx").on(
      table.documentContentKeyEpochId,
      table.containerId,
    ),
  ],
);

/**
 * Verified write headers for encrypted document updates.
 *
 * Loro update bytes are stored in the imported `documentUpdates` table, while
 * this table stores the keying write header that authorizes and describes the
 * ciphertext. The header binds an update to a document, content-key epoch,
 * access manifest, target set, encryption suite, content record id, nonce
 * domain, writer, ciphertext hash, and a metadata hash that commits the
 * update's domain-separated, record-key-derived plaintext HMAC. Replays for
 * the same `updateId` are accepted only when the computed `headerHash` matches
 * the stored value.
 *
 * Columns:
 * - `updateId`: Primary key matching the live document update id.
 * - `documentId`: Document whose encrypted update this header describes.
 * - `organizationId`: Organization boundary from the verified header.
 * - `contentKeyEpoch`: Document content-key epoch used for the update.
 * - `accessManifestHash`: Document access manifest hash verified for the
 *   write.
 * - `targetHash`: Document content-key target hash verified for the write.
 * - `encryptionSuite`: Content-record encryption suite used by the client.
 * - `contentRecordId`: Client content record id inside the header. For
 *   document updates this is unique within `(documentId, contentKeyEpoch)`.
 * - `nonceDomainHash`: Nonce-domain commitment; uniqueness prevents reusing a
 *   nonce domain within the same document content-key epoch.
 * - `headerHash`: Hash of the canonical write header.
 * - `header`: Full canonical write header JSON returned with sync results.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(documentId, contentKeyEpoch)` supports epoch-scoped document sync and
 *   diagnostics.
 * - `headerHash` is unique because it content-addresses the write header.
 * - `(documentId, contentKeyEpoch, contentRecordId)` prevents duplicate content
 *   record ids for an epoch.
 * - `(documentId, contentKeyEpoch, nonceDomainHash)` prevents nonce-domain
 *   reuse for an epoch.
 */
export const documentContentWriteHeaders = pgTable(
  "document_content_write_headers",
  {
    updateId: uuid("update_id").primaryKey(),
    documentId: uuid("document_id").notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("document_content_write_headers_document_epoch_idx").on(
      table.documentId,
      table.contentKeyEpoch,
    ),
    index("document_content_write_headers_organization_update_idx").on(
      table.organizationId,
      table.updateId,
    ),
    uniqueIndex("document_content_write_headers_header_hash_idx").on(
      table.headerHash,
    ),
    uniqueIndex("document_content_write_headers_content_record_idx").on(
      table.documentId,
      table.contentKeyEpoch,
      table.contentRecordId,
    ),
    uniqueIndex("document_content_write_headers_nonce_domain_idx").on(
      table.documentId,
      table.contentKeyEpoch,
      table.nonceDomainHash,
    ),
  ],
);
