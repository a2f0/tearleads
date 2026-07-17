import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Cursor and lane-level fields for one locally projected organization. */
export const organizationReadModelState = sqliteTable(
  "organization_read_model_state",
  {
    organizationId: text("organization_id").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    cursor: text("cursor").notNull(),
    profileDocumentId: text("profile_document_id"),
    memberGroupId: text("member_group_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId] })],
);

/** Requester-scoped fields that must not become organization-global state. */
export const organizationReadModelRequesters = sqliteTable(
  "organization_read_model_requesters",
  {
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    isOrgAdmin: integer("is_org_admin", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

/** Normalized organization directory rows. `isSelf` is derived at read time. */
export const organizationReadModelDirectoryUsers = sqliteTable(
  "organization_read_model_directory_users",
  {
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
    signingPublicKey: text("signing_public_key").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    encapsulationKeyFingerprint: text(
      "encapsulation_key_fingerprint",
    ).notNull(),
    createdAt: text("created_at").notNull(),
    status: text("status").notNull(),
    profileDocumentId: text("profile_document_id"),
    joinedAt: text("joined_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    disabledAt: text("disabled_at"),
    disabledByUserId: text("disabled_by_user_id"),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

/** Normalized organization group summaries and their current state heads. */
export const organizationReadModelGroups = sqliteTable(
  "organization_read_model_groups",
  {
    organizationId: text("organization_id").notNull(),
    groupId: text("group_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull(),
    stateHash: text("state_hash"),
    stateVersion: integer("state_version"),
    keyEpoch: integer("key_epoch"),
    memberCount: integer("member_count"),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.groupId] })],
);
