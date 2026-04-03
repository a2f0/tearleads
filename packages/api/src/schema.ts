import { documents, documentUpdates } from "@tearleads/loro/server";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  signingPublicKey: text("signing_public_key").notNull(),
  encapsulationPublicKey: text("encapsulation_public_key").notNull(),
  encapsulationKeyFingerprint: text("encapsulation_key_fingerprint"),
  defaultOrganizationId: uuid("default_organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  encryptedData: text("encrypted_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const containers = pgTable("containers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const objectRecipientEnvelopes = pgTable("object_recipient_envelopes", {
  id: uuid("id").defaultRandom().primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  epoch: integer("epoch").notNull(),
  recipientUserId: text("recipient_user_id").notNull(),
  recipientKeyFingerprint: text("recipient_key_fingerprint").notNull(),
  kemCipherText: text("kem_cipher_text"),
  wrappedKey: text("wrapped_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documentContainerLinks = pgTable("document_container_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: text("document_id").notNull(),
  containerId: uuid("container_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blobs = pgTable("blobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  storageKey: text("storage_key").notNull(),
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

export const attachmentBindings = pgTable("attachment_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: text("document_id").notNull(),
  slotId: text("slot_id").notNull(),
  blobId: uuid("blob_id").notNull(),
  previousBindingId: uuid("previous_binding_id"),
  detachedAt: timestamp("detached_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export { documents, documentUpdates };
