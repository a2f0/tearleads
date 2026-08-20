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

/** Exact policy-state heads used to bind locally projected cryptographic data. */
export const organizationReadModelPolicyHeads = sqliteTable(
  "organization_read_model_policy_heads",
  {
    organizationId: text("organization_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    stateVersion: integer("state_version").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    memberCount: integer("member_count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.principalType, table.principalId],
    }),
  ],
);

/** State-hash-bound completeness rows for each projected group membership. */
export const organizationReadModelGroupMemberships = sqliteTable(
  "organization_read_model_group_memberships",
  {
    organizationId: text("organization_id").notNull(),
    groupId: text("group_id").notNull(),
    stateHash: text("state_hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.groupId] })],
);

/**
 * Direct members bound to the exact state in the membership completeness row.
 *
 * `member_principal_type`/`member_principal_id` were REPLACED by `user_id` when
 * group nesting was removed, WITHOUT a migration, under the greenfield reset
 * documented on the `documents` table: no database predating the change
 * survives it. A database that did survive would keep the old NOT NULL columns
 * — `CREATE TABLE IF NOT EXISTS` never alters an existing table — and every
 * insert here would fail against them. The read-model is a server-refetchable
 * cache, so the reset costs nothing but a re-snapshot; the read-model protocol
 * version and the local backup format version were both bumped alongside it so
 * a stale peer or backup fails loudly rather than writing into the old shape.
 */
export const organizationReadModelGroupMembers = sqliteTable(
  "organization_read_model_group_members",
  {
    organizationId: text("organization_id").notNull(),
    groupId: text("group_id").notNull(),
    userId: text("user_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    stateHash: text("state_hash").notNull(),
    role: text("role").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint"),
    signingPublicKey: text("signing_public_key"),
    encapsulationPublicKey: text("encapsulation_public_key"),
    encapsulationKeyFingerprint: text("encapsulation_key_fingerprint"),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.groupId, table.userId],
    }),
  ],
);

/**
 * Durable record of a server 403/404 for one requester's presentation
 * projection. Written before the revoked rows are purged so a purge failure
 * followed by an offline restart cannot serve the revoked projection; cleared
 * only by a successful authoritative reconcile for the same scope.
 */
export const organizationPresentationDenials = sqliteTable(
  "organization_presentation_denials",
  {
    organizationId: text("organization_id").notNull(),
    requesterUserId: text("requester_user_id").notNull(),
    projection: text("projection").notNull(),
    deniedAt: text("denied_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.requesterUserId, table.projection],
    }),
  ],
);

/** Whole-lane container grants used only by organization presentation reads. */
export const organizationReadModelContainerGrants = sqliteTable(
  "organization_read_model_container_grants",
  {
    organizationId: text("organization_id").notNull(),
    containerId: text("container_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    accessLevel: text("access_level").notNull(),
    createdAt: text("created_at").notNull(),
    depth: integer("depth").notNull(),
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull(),
    metadataAccessEpoch: integer("metadata_access_epoch").notNull(),
    metadataAccessStateHash: text("metadata_access_state_hash").notNull(),
    metadataDocumentId: text("metadata_document_id"),
    parentId: text("parent_id"),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id"),
    signingKeyFingerprint: text("signing_key_fingerprint"),
    groupId: text("group_id"),
    groupName: text("group_name"),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.containerId,
        table.subjectType,
        table.subjectId,
      ],
    }),
  ],
);
