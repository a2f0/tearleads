import type {
  ManagedRecipientPrincipalType,
  PrincipalProjectionRole,
  PrincipalStateMembershipMode,
  PrincipalStateMemberType,
  PrincipalStatePayloadCipherSuite,
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

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMembers = pgTable("group_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
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
    signerKeyId: text("signer_key_id").notNull(),
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
    detachedAt: timestamp("detached_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("attachment_bindings_previous_binding_id_idx").on(
      table.previousBindingId,
    ),
  ],
);

export { documents, documentUpdateSpans, documentUpdates };
