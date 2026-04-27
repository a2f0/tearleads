import type {
  AccessEventTypeV2,
  AccessObjectKindV2,
  ContentRecordEncryptionSuiteV2,
  KekRecipientKindV2,
  KeyingV2CanonicalJson,
  ManagedPrincipalKindV2,
  ManagedRecipientPrincipalType,
  PrincipalProjectionRole,
  PrincipalStateMembershipMode,
  PrincipalStateMemberType,
  PrincipalStatePayloadCipherSuite,
  ReferencedPrincipalHeadV2,
  WriteHeaderV2,
} from "@tearleads/crypto";
import {
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/loro/server";
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
import type { RecipientPrincipalType } from "./access/recipientPrincipals";

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
  (table) => [index("containers_parent_id_idx").on(table.parentId)],
);

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const objectAccessGrants = pgTable("object_access_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  accessLevel: text("access_level").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const objectAccessEpochs = pgTable("object_access_epochs", {
  id: uuid("id").defaultRandom().primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  epoch: integer("epoch").notNull(),
  accessFingerprint: text("access_fingerprint").notNull(),
  accessStateHash: text("access_state_hash"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Legacy V1 direct recipient envelopes. V2 document/blob key delivery uses
// container KEK wraps plus document/blob content-key target tables; structural
// and write paths must not fan out descendant document/blob rows here.
export const objectRecipientEnvelopes = pgTable(
  "object_recipient_envelopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    epoch: integer("epoch").notNull(),
    recipientPrincipalType: text("recipient_principal_type")
      .$type<RecipientPrincipalType>()
      .notNull(),
    recipientPrincipalId: text("recipient_principal_id").notNull(),
    recipientKeyFingerprint: text("recipient_key_fingerprint").notNull(),
    kemCipherText: text("kem_cipher_text").notNull(),
    wrappedKey: text("wrapped_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("object_recipient_envelopes_object_epoch_idx").on(
      table.objectType,
      table.objectId,
      table.epoch,
    ),
    uniqueIndex("object_recipient_envelopes_object_epoch_recipient_idx").on(
      table.objectType,
      table.objectId,
      table.epoch,
      table.recipientKeyFingerprint,
    ),
  ],
);

export const accessEvents = pgTable(
  "access_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").$type<AccessEventTypeV2>().notNull(),
    objectKind: text("object_kind").$type<AccessObjectKindV2>().notNull(),
    objectId: text("object_id").notNull(),
    organizationId: text("organization_id").notNull(),
    previousManifestHash: text("previous_manifest_hash"),
    dependencyManifestHashes: jsonb("dependency_manifest_hashes")
      .$type<string[]>()
      .notNull(),
    bodyHash: text("body_hash").notNull(),
    body: jsonb("body").$type<KeyingV2CanonicalJson>().notNull(),
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
    objectKind: text("object_kind").$type<AccessObjectKindV2>().notNull(),
    objectId: text("object_id").notNull(),
    organizationId: text("organization_id").notNull(),
    epoch: integer("epoch").notNull(),
    previousManifestHash: text("previous_manifest_hash"),
    eventHash: text("event_hash").notNull(),
    structuralHash: text("structural_hash").notNull(),
    grantRoot: text("grant_root").notNull(),
    referencedPrincipalHeads: jsonb("referenced_principal_heads")
      .$type<ReferencedPrincipalHeadV2[]>()
      .notNull(),
    keyTargetHash: text("key_target_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    state: jsonb("state").$type<KeyingV2CanonicalJson>().notNull(),
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
    objectKind: text("object_kind").$type<AccessObjectKindV2>().notNull(),
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
    recipientKind: text("recipient_kind").$type<KekRecipientKindV2>().notNull(),
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
    objectKind: text("object_kind").$type<AccessObjectKindV2>().notNull(),
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
    objectKind: text("object_kind").$type<AccessObjectKindV2>().notNull(),
    objectId: text("object_id").notNull(),
    principalType: text("principal_type")
      .$type<ManagedPrincipalKindV2>()
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
      .$type<KeyingV2CanonicalJson>()
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
      .$type<ContentRecordEncryptionSuiteV2>()
      .notNull(),
    contentRecordId: text("content_record_id").notNull(),
    nonceDomainHash: text("nonce_domain_hash").notNull(),
    headerHash: text("header_hash").notNull(),
    header: jsonb("header").$type<WriteHeaderV2>().notNull(),
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
      .$type<KeyingV2CanonicalJson>()
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
      .$type<ContentRecordEncryptionSuiteV2>()
      .notNull(),
    contentRecordId: text("content_record_id").notNull(),
    nonceDomainHash: text("nonce_domain_hash").notNull(),
    headerHash: text("header_hash").notNull(),
    header: jsonb("header").$type<WriteHeaderV2>().notNull(),
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

export const documentContainerLinks = pgTable("document_container_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: text("document_id").notNull(),
  containerId: uuid("container_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
    accessFingerprint: text("access_fingerprint").notNull(),
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
    accessFingerprint: text("access_fingerprint").notNull(),
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
    index("attachment_bindings_previous_binding_id_idx").on(
      table.previousBindingId,
    ),
    index("attachment_bindings_attachment_event_hash_idx").on(
      table.attachmentEventHash,
    ),
  ],
);

export { documents, documentUpdateSpans, documentUpdates };
