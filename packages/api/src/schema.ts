import type {
  AccessEventType,
  AccessObjectKind,
  ContentRecordEncryptionSuite,
  KekRecipientKind,
  KeyingCanonicalJson,
  ManagedPrincipalKind,
  ManagedRecipientPrincipalType,
  PrincipalProjectionRole,
  PrincipalStateMembershipMode,
  PrincipalStateMemberType,
  PrincipalStatePayloadCipherSuite,
  ReferencedPrincipalHead,
  WriteHeader,
} from "@tearleads/crypto";
import {
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/loro/server";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type BlobAuditRetentionMode = "live_only";
export type DocumentAttachmentAuditAction =
  | "attach"
  | "replace"
  | "detach"
  | "rewrap";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  signingPublicKey: text("signing_public_key").notNull(),
  encapsulationPublicKey: text("encapsulation_public_key").notNull(),
  encapsulationKeyFingerprint: text("encapsulation_key_fingerprint").notNull(),
  defaultOrganizationId: uuid("default_organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const containers = pgTable(
  "containers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("containers_org_root_idx")
      .on(table.organizationId)
      .where(sql`${table.parentId} is null`),
    index("containers_parent_id_idx").on(table.parentId),
  ],
);

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Signed state history for managed recipient principals.
 *
 * A managed recipient principal is currently either an `organization` or a
 * `group`. Users have their own key rows in `users`; this table is for
 * principals whose membership and encryption key material are themselves
 * managed by signed policy state.
 *
 * Each row stores the signed, public header for one principal state version.
 * The encrypted policy payload is stored separately in
 * `principalStatePayloads`, the queryable membership/role projection is stored
 * in `principalMembershipProjection`, and the active recipient key material is
 * indexed in `principalEpochKeys`. Those companion tables are addressed by the
 * same `(principalType, principalId, stateHash)` identity.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain logic uses the principal
 *   identity and `stateHash`; this is only a row identifier.
 * - `principalType`: Managed principal kind, currently `organization` or
 *   `group`.
 * - `principalId`: The stable id of the organization/group whose policy this
 *   state describes. This is text because the signed crypto payload models
 *   principal ids as strings.
 * - `version`: Monotonic signed version for this principal. Version `1` must
 *   have `prevStateHash = null`; later versions must point to the previous
 *   current state's hash.
 * - `prevStateHash`: Hash-chain pointer to the previous signed state header,
 *   or `null` for the initial state.
 * - `keyEpoch`: Principal wrapping-key epoch referenced by this state. It may
 *   stay the same for additive policy changes, but cannot decrease; key
 *   material changes and membership shrink require a new epoch.
 * - `encapsulationPublicKey`: Public KEM key for the principal at `keyEpoch`.
 *   Members encrypt/rewrap principal key material to this public key.
 * - `keyFingerprint`: Fingerprint of `encapsulationPublicKey`; verified before
 *   storage and copied into `principalEpochKeys` for recipient lookup.
 * - `membershipMode`: How direct members are represented. Only `projection` is
 *   currently supported.
 * - `membershipRoot`: Canonical hash of the normalized direct member list that
 *   was signed by the principal state.
 * - `projectionRoot`: Canonical hash of the normalized query projection
 *   entries, including member roles. It must match
 *   `principalMembershipProjection` rows for this `stateHash`.
 * - `payloadCiphertextHash`: Hash of the encrypted policy payload ciphertext in
 *   `principalStatePayloads`; binds the private payload to the signed header.
 * - `memberCount`: Number of projected members signed into this state. Used as
 *   a cheap consistency check against `principalMembershipProjection`.
 * - `stateHash`: Hash of the normalized unsigned state header. This excludes
 *   `signature` and is the stable content address used by manifests, payload
 *   rows, projection rows, and epoch-key rows.
 * - `signedAt`: Client-supplied timestamp included in the signed header.
 * - `signerUserId`: User who signed this state. Initial states require this
 *   user to be an admin in the new projection; successor states require the
 *   user to have been an admin in the previous projection.
 * - `signerUserKeyFingerprint`: Signing key fingerprint for `signerUserId`.
 *   The stored user signing key is loaded by this fingerprint before verifying
 *   `signature`.
 * - `signature`: Signature over the normalized unsigned state header.
 * - `createdAt`: Server-side insertion timestamp; not part of the signed
 *   header or `stateHash`.
 *
 * Indexes:
 * - `(principalType, principalId)` supports loading a principal's state
 *   history and current state.
 * - `(principalType, principalId, version)` is unique so a version cannot be
 *   reused for conflicting state.
 * - `(principalType, principalId, stateHash)` is unique because state hashes are
 *   the content-addressed references used by the rest of the access system.
 */
export const principalStates = pgTable(
  "principal_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    version: integer("version").notNull(),
    prevStateHash: text("prev_state_hash"),
    keyEpoch: integer("key_epoch").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    membershipMode: text("membership_mode")
      .$type<PrincipalStateMembershipMode>()
      .notNull(),
    membershipRoot: text("membership_root").notNull(),
    projectionRoot: text("projection_root").notNull(),
    payloadCiphertextHash: text("payload_ciphertext_hash").notNull(),
    memberCount: integer("member_count").notNull(),
    stateHash: text("state_hash").notNull(),
    signedAt: timestamp("signed_at").notNull(),
    signerUserId: uuid("signer_user_id").notNull(),
    signerUserKeyFingerprint: text("signer_user_key_fingerprint").notNull(),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_states_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("principal_states_principal_version_idx").on(
      table.principalType,
      table.principalId,
      table.version,
    ),
    uniqueIndex("principal_states_principal_state_hash_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
    ),
  ],
);

/**
 * Encrypted payloads for signed principal state versions.
 *
 * `principalStates` stores only the signed public header: hashes, signer
 * identity, key epoch, and projection commitments. This table stores the
 * encrypted private payload for that same state. The server does not interpret
 * the plaintext; it only verifies that the ciphertext hash matches both this
 * row and the `payloadCiphertextHash` signed into the corresponding
 * `principalStates` row.
 *
 * There is one payload row per principal state hash. Storing it separately keeps
 * principal-state history queryable by public header fields while allowing
 * clients to retrieve the encrypted policy payload when reconstructing a
 * principal policy bundle.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain lookups use
 *   `(principalType, principalId, stateHash)`.
 * - `principalType`: Managed principal kind, currently `organization` or
 *   `group`. Matches `principalStates.principalType`.
 * - `principalId`: Stable id of the managed principal whose encrypted policy
 *   payload this is. Matches `principalStates.principalId`.
 * - `stateHash`: Content address of the signed principal state header this
 *   payload belongs to. This joins the payload back to `principalStates` and is
 *   the value referenced by manifests and policy bundles.
 * - `cipherSuite`: Symmetric encryption scheme used by the client for the
 *   payload ciphertext. Only `aes-256-gcm` is currently supported.
 * - `ciphertext`: The encrypted principal policy payload. The server stores and
 *   returns it opaquely; clients with the appropriate principal/member key
 *   material decrypt it.
 * - `ciphertextHash`: Hash of `ciphertext`. On write, this is recomputed and
 *   must match both the submitted payload hash and the signed
 *   `principalStates.payloadCiphertextHash`.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the signed
 *   principal state header or payload hash.
 *
 * Indexes:
 * - `(principalType, principalId)` supports listing or loading payloads for a
 *   principal's state history.
 * - `(principalType, principalId, stateHash)` is unique because a state hash has
 *   exactly one encrypted payload. Replays must provide byte-for-byte matching
 *   payload data.
 */
export const principalStatePayloads = pgTable(
  "principal_state_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    cipherSuite: text("cipher_suite")
      .$type<PrincipalStatePayloadCipherSuite>()
      .notNull(),
    ciphertext: text("ciphertext").notNull(),
    ciphertextHash: text("ciphertext_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_state_payloads_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("principal_state_payloads_principal_state_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
    ),
  ],
);

export const principalMembershipProjection = pgTable(
  "principal_membership_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    memberPrincipalType: text("member_principal_type")
      .$type<PrincipalStateMemberType>()
      .notNull(),
    memberPrincipalId: text("member_principal_id").notNull(),
    role: text("role").$type<PrincipalProjectionRole>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_membership_projection_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("principal_membership_projection_state_member_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.memberPrincipalType,
      table.memberPrincipalId,
    ),
  ],
);

export const principalEpochKeys = pgTable(
  "principal_epoch_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    epoch: integer("epoch").notNull(),
    introducedByStateHash: text("introduced_by_state_hash").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_epoch_keys_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("principal_epoch_keys_principal_epoch_idx").on(
      table.principalType,
      table.principalId,
      table.epoch,
    ),
  ],
);

export const principalMemberEnvelopes = pgTable(
  "principal_member_envelopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    epoch: integer("epoch").notNull(),
    memberPrincipalType: text("member_principal_type")
      .$type<PrincipalStateMemberType>()
      .notNull(),
    memberPrincipalId: text("member_principal_id").notNull(),
    memberKeyFingerprint: text("member_key_fingerprint").notNull(),
    kemCipherText: text("kem_cipher_text").notNull(),
    wrappedKey: text("wrapped_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_member_envelopes_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("principal_member_envelopes_state_member_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.memberPrincipalType,
      table.memberPrincipalId,
    ),
  ],
);

export const accessEvents = pgTable(
  "access_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").$type<AccessEventType>().notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: text("object_id").notNull(),
    organizationId: text("organization_id").notNull(),
    previousManifestHash: text("previous_manifest_hash"),
    dependencyManifestHashes: jsonb("dependency_manifest_hashes")
      .$type<string[]>()
      .notNull(),
    bodyHash: text("body_hash").notNull(),
    body: jsonb("body").$type<KeyingCanonicalJson>().notNull(),
    eventHash: text("event_hash").notNull(),
    signerUserId: text("signer_user_id").notNull(),
    signerDeviceId: text("signer_device_id").notNull(),
    signerKeyFingerprint: text("signer_key_fingerprint").notNull(),
    signature: text("signature").notNull(),
    signedAt: timestamp("signed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_events_event_id_idx").on(table.eventId),
    uniqueIndex("access_events_event_hash_idx").on(table.eventHash),
    index("access_events_object_idx").on(table.objectKind, table.objectId),
    index("access_events_signer_idx").on(
      table.signerUserId,
      table.signerKeyFingerprint,
    ),
  ],
);

export const accessManifests = pgTable(
  "access_manifests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: text("object_id").notNull(),
    organizationId: text("organization_id").notNull(),
    epoch: integer("epoch").notNull(),
    previousManifestHash: text("previous_manifest_hash"),
    eventHash: text("event_hash").notNull(),
    structuralHash: text("structural_hash").notNull(),
    grantRoot: text("grant_root").notNull(),
    referencedPrincipalHeads: jsonb("referenced_principal_heads")
      .$type<ReferencedPrincipalHead[]>()
      .notNull(),
    keyTargetHash: text("key_target_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    state: jsonb("state").$type<KeyingCanonicalJson>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_manifests_manifest_hash_idx").on(table.manifestHash),
    uniqueIndex("access_manifests_event_hash_idx").on(table.eventHash),
    uniqueIndex("access_manifests_object_epoch_idx").on(
      table.objectKind,
      table.objectId,
      table.epoch,
    ),
    index("access_manifests_object_idx").on(table.objectKind, table.objectId),
  ],
);

export const accessManifestHeads = pgTable(
  "access_manifest_heads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: text("object_id").notNull(),
    organizationId: text("organization_id").notNull(),
    epoch: integer("epoch").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_manifest_heads_object_idx").on(
      table.objectKind,
      table.objectId,
    ),
    index("access_manifest_heads_manifest_hash_idx").on(table.manifestHash),
  ],
);

export const containerKeyEpochs = pgTable(
  "container_key_epochs",
  {
    id: text("id").primaryKey(),
    containerId: text("container_id").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    accessManifestHash: text("access_manifest_hash").notNull(),
    parentContainerKeyEpochId: text("parent_container_key_epoch_id"),
    createdByEventHash: text("created_by_event_hash").notNull(),
    createdByManifestHash: text("created_by_manifest_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_key_epochs_container_epoch_idx").on(
      table.containerId,
      table.keyEpoch,
    ),
    index("container_key_epochs_container_idx").on(table.containerId),
    index("container_key_epochs_access_manifest_idx").on(
      table.accessManifestHash,
    ),
    index("container_key_epochs_parent_idx").on(
      table.parentContainerKeyEpochId,
    ),
  ],
);

export const containerKeyWraps = pgTable(
  "container_key_wraps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    containerKeyEpochId: text("container_key_epoch_id").notNull(),
    recipientKind: text("recipient_kind").$type<KekRecipientKind>().notNull(),
    recipientId: text("recipient_id").notNull(),
    recipientKeyEpochId: text("recipient_key_epoch_id").notNull(),
    recipientKeyFingerprint: text("recipient_key_fingerprint").notNull(),
    kemCipherText: text("kem_cipher_text").notNull(),
    wrappedKey: text("wrapped_key").notNull(),
    wrapManifestHash: text("wrap_manifest_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_key_wraps_epoch_recipient_idx").on(
      table.containerKeyEpochId,
      table.recipientKind,
      table.recipientId,
      table.recipientKeyEpochId,
    ),
    index("container_key_wraps_epoch_idx").on(table.containerKeyEpochId),
    index("container_key_wraps_recipient_idx").on(
      table.recipientKind,
      table.recipientId,
    ),
    index("container_key_wraps_manifest_idx").on(table.wrapManifestHash),
  ],
);

// Derived cache only. Access decisions must verify the source event/manifest.
export const accessEventDependencyProjection = pgTable(
  "access_event_dependency_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventHash: text("event_hash").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: text("object_id").notNull(),
    dependencyManifestHash: text("dependency_manifest_hash").notNull(),
    dependencyIndex: integer("dependency_index").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("access_event_dependency_projection_event_idx").on(table.eventHash),
    index("access_event_dependency_projection_dependency_idx").on(
      table.dependencyManifestHash,
    ),
    uniqueIndex("access_event_dependency_projection_unique_idx").on(
      table.eventHash,
      table.dependencyManifestHash,
    ),
  ],
);

// Derived cache only. Access decisions must verify the source event/manifest.
export const accessManifestPrincipalHeadProjection = pgTable(
  "access_manifest_principal_head_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: text("object_id").notNull(),
    principalType: text("principal_type")
      .$type<ManagedPrincipalKind>()
      .notNull(),
    principalId: text("principal_id").notNull(),
    version: integer("version").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    stateHash: text("state_hash").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("access_manifest_principal_projection_manifest_idx").on(
      table.manifestHash,
    ),
    index("access_manifest_principal_projection_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    uniqueIndex("access_manifest_principal_projection_unique_idx").on(
      table.manifestHash,
      table.principalType,
      table.principalId,
    ),
  ],
);

// Derived cache only. Document link authority is the signed document manifest.
export const accessManifestDocumentLinkProjection = pgTable(
  "access_manifest_document_link_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("access_manifest_document_link_manifest_idx").on(table.manifestHash),
    index("access_manifest_document_link_document_idx").on(table.documentId),
    index("access_manifest_document_link_container_idx").on(table.containerId),
    uniqueIndex("access_manifest_document_link_unique_idx").on(
      table.manifestHash,
      table.containerId,
    ),
  ],
);

export const documentContentKeyEpochs = pgTable(
  "document_content_key_epochs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: text("document_id").notNull(),
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

export const documentContentKeyTargets = pgTable(
  "document_content_key_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentContentKeyEpochId: uuid("document_content_key_epoch_id")
      .notNull()
      .references(() => documentContentKeyEpochs.id),
    containerId: text("container_id").notNull(),
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

export const documentContentWriteHeaders = pgTable(
  "document_content_write_headers",
  {
    updateId: uuid("update_id").primaryKey(),
    documentId: text("document_id").notNull(),
    organizationId: text("organization_id").notNull(),
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

export const blobContentKeyTargets = pgTable(
  "blob_content_key_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blobContentKeyEpochId: uuid("blob_content_key_epoch_id")
      .notNull()
      .references(() => blobContentKeyEpochs.id),
    bindingId: uuid("binding_id").notNull(),
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
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

export const blobContentWriteHeaders = pgTable(
  "blob_content_write_headers",
  {
    recordId: uuid("record_id").primaryKey(),
    blobId: uuid("blob_id").notNull(),
    organizationId: text("organization_id").notNull(),
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
    index("blob_content_write_headers_blob_epoch_idx").on(
      table.blobId,
      table.contentKeyEpoch,
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

export const documentContainerLinks = pgTable(
  "document_container_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: text("document_id").notNull(),
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

export const containerMetadataDocuments = pgTable(
  "container_metadata_documents",
  {
    containerId: uuid("container_id").primaryKey(),
    documentId: uuid("document_id").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export const documentAuditCheckpoints = pgTable(
  "document_audit_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
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

export const documentAuditEntries = pgTable(
  "document_audit_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
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
    encryptedUpdateSha256: text("encrypted_update_sha256").notNull(),
    encryptedUpdateByteLength: integer(
      "encrypted_update_byte_length",
    ).notNull(),
  },
);

export const blobAuditObjects = pgTable("blob_audit_objects", {
  blobId: uuid("blob_id").primaryKey(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  liveStorageKey: text("live_storage_key"),
  retentionMode: text("retention_mode")
    .$type<BlobAuditRetentionMode>()
    .notNull(),
  historicalBytesRetained: boolean("historical_bytes_retained").notNull(),
  prunedAt: timestamp("pruned_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const blobs = pgTable("blobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  storageKey: text("storage_key").notNull(),
  encryptedBytes: text("encrypted_bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blobStages = pgTable("blob_stages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  encryptedBytes: text("encrypted_bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const attachmentBindings = pgTable(
  "attachment_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: text("document_id").notNull(),
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

export { documents, documentUpdateSpans, documentUpdates };
