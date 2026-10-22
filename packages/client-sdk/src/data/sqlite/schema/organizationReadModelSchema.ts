import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Cursor and lane-level fields for one locally projected organization: the
 * exact organization policy head, and the state hash of the reserved Members
 * group's membership head, which the group catalog does not list.
 */
export const organizationReadModelState = sqliteTable(
  "organization_read_model_state",
  {
    organizationId: text("organization_id").notNull(),
    cursor: text("cursor").notNull(),
    profileDocumentId: text("profile_document_id"),
    memberGroupId: text("member_group_id").notNull(),
    memberGroupStateHash: text("member_group_state_hash").notNull(),
    organizationStateHash: text("organization_state_hash").notNull(),
    organizationStateVersion: integer("organization_state_version").notNull(),
    organizationKeyEpoch: integer("organization_key_epoch").notNull(),
    organizationKeyFingerprint: text("organization_key_fingerprint").notNull(),
    organizationMemberCount: integer("organization_member_count").notNull(),
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
    isPersonalOrganizationOwner: integer("is_personal_organization_owner", {
      mode: "boolean",
    }).notNull(),
    createdAt: text("created_at").notNull(),
    status: text("status").notNull(),
    profileDocumentId: text("profile_document_id"),
    joinedAt: text("joined_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    disabledAt: text("disabled_at"),
    disabledByUserId: text("disabled_by_user_id"),
    /** A pending leave request, as JSON, kept only once its signature verified. */
    leaveRequest: text("leave_request"),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

/**
 * Normalized visible organization group summaries. The state columns are the
 * group's exact policy head, all null for a stateless group.
 * `members_state_hash` is the state hash of the membership head delivered for
 * the group, null until the groupMemberships lane covers it.
 */
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
    keyFingerprint: text("key_fingerprint"),
    memberCount: integer("member_count"),
    membersStateHash: text("members_state_hash"),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.groupId] })],
);

/**
 * Direct users bound to the exact state of their group's membership head.
 * Public keys are not repeated here; the directory lane holds them per user.
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
