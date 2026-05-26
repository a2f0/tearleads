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
export type ContainerSyncTombstoneReason = "access_revoked" | "deleted";
export type DocumentAttachmentAuditAction =
  | "attach"
  | "replace"
  | "detach"
  | "rewrap";
export type OrganizationRosterStatus = "active" | "disabled";

/**
 * Registered human users and their long-lived public key material.
 *
 * A user row is created during user registration. The access workflows
 * load this table to verify signatures, encrypt user-recipient envelopes, and
 * resolve the user's default personal organization/root container context.
 * Private keys never live in this table; only public keys and fingerprints are
 * stored.
 *
 * Columns:
 * - `id`: Stable server-side user id.
 * - `fingerprint`: Unique signing key fingerprint used by authentication and
 *   signature verification.
 * - `signingPublicKey`: Public signing key bytes, base64 encoded.
 * - `encapsulationPublicKey`: Public KEM/encapsulation key bytes, base64
 *   encoded. Writers use this when wrapping material directly to the user.
 * - `encapsulationKeyFingerprint`: Fingerprint of `encapsulationPublicKey`.
 *   Recipient-envelope verification compares submitted fingerprints to this
 *   value.
 * - `defaultOrganizationId`: Personal/default organization created during
 *   registration and used as the user's initial organization boundary.
 * - `createdAt`: Server-side registration timestamp.
 *
 * Indexes:
 * - `users_fingerprint_unique` enforces one signing key fingerprint per user
 *   and gives auth challenge verification an indexed `fingerprint` lookup.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  signingPublicKey: text("signing_public_key").notNull(),
  encapsulationPublicKey: text("encapsulation_public_key").notNull(),
  encapsulationKeyFingerprint: text("encapsulation_key_fingerprint").notNull(),
  defaultOrganizationId: uuid("default_organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Organization catalog rows.
 *
 * Organizations define the top-level ownership boundary for containers,
 * documents, manifests, and keying state. Registration creates a personal
 * organization named `Personal`; the signed principal-state tables carry the
 * organization's access policy and recipient key history.
 *
 * Columns:
 * - `id`: Stable organization id. Container and access-manifest rows copy this
 *   id as their organization boundary.
 * - `adminGroupId`: Reserved organization-scoped group whose reachable members
 *   have organization-admin authority.
 * - `memberGroupId`: Reserved organization-scoped group whose reachable
 *   members belong to the organization.
 * - `name`: Human-readable organization name.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminGroupId: uuid("admin_group_id").notNull(),
  memberGroupId: uuid("member_group_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Organization roster lifecycle and encrypted profile binding rows.
 *
 * This table is product state, not access authority. Signed groups and
 * container grants decide access. Roster rows let org-manager keep showing
 * disabled/departed accounts and bind private profile fields to encrypted Loro
 * documents without exposing names, email addresses, titles, or notes to the
 * server.
 *
 * Columns:
 * - `organizationId`: Organization that owns the roster entry.
 * - `userId`: Global user identity represented by this roster entry.
 * - `status`: Lifecycle state. Disabled users may remain visible in the
 *   directory even after they are removed from access groups.
 * - `profileDocumentId`: Optional encrypted document containing org-scoped
 *   profile/contact fields such as first name, last name, email, and title.
 * - `joinedAt`: When the user first became visible in this organization
 *   roster.
 * - `disabledAt` / `disabledByUserId`: Deactivation audit metadata.
 * - `createdAt` / `updatedAt`: Server-side row timestamps.
 */
export const organizationRosterEntries = pgTable(
  "organization_roster_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    status: text("status")
      .$type<OrganizationRosterStatus>()
      .default("active")
      .notNull(),
    profileDocumentId: uuid("profile_document_id"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    disabledAt: timestamp("disabled_at"),
    disabledByUserId: uuid("disabled_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_roster_entries_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_roster_entries_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("organization_roster_entries_profile_document_idx").on(
      table.profileDocumentId,
    ),
  ],
);

/**
 * Materialized container tree structure.
 *
 * This table stores only the mutable structural shape needed for container
 * listing and parent-child checks. Authorization, grants, metadata-document
 * pointers, and KEK target state are verified from signed access manifests and
 * their projection tables.
 *
 * Columns:
 * - `id`: Stable container id.
 * - `organizationId`: Organization boundary for the container. Parent and child
 *   containers must stay within the same organization.
 * - `parentId`: Parent container id, or `null` for the organization's root
 *   container.
 * - `systemSlot`: Optional opaque app-owned system slot. System containers
 *   are rooted under the organization root and cannot be removed through the
 *   public container delete API.
 * - `depth`: Materialized distance from the root container. Roots are `0`.
 * - `createdAt`: Server-side insertion timestamp.
 * - `updatedAt`: Server-side sync timestamp bumped when the container,
 *   metadata document, or visible contents change.
 *
 * Indexes:
 * - `organizationId where parentId is null` is unique so an organization has
 *   one root container.
 * - `organizationId, systemSlot where systemSlot is not null` keeps each
 *   system slot unique per organization.
 * - `parentId` supports direct child lookups and move validation.
 * - `(parentId, updatedAt, id)` supports parent-container sync lanes.
 * - `(organizationId, depth, updatedAt, id)` keeps depth indexed for tree
 *   traversal and depth-bounded maintenance.
 */
export const containers = pgTable(
  "containers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    parentId: uuid("parent_id"),
    systemSlot: text("system_slot"),
    depth: integer("depth").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("containers_org_root_idx")
      .on(table.organizationId)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("containers_org_system_slot_idx")
      .on(table.organizationId, table.systemSlot)
      .where(sql`${table.systemSlot} is not null`),
    index("containers_parent_id_idx").on(table.parentId),
    index("containers_parent_updated_idx").on(
      table.parentId,
      table.updatedAt,
      table.id,
    ),
    index("containers_org_depth_updated_idx").on(
      table.organizationId,
      table.depth,
      table.updatedAt,
      table.id,
    ),
    index("containers_parent_depth_idx").on(table.parentId, table.depth),
  ],
);

/**
 * Per-user tombstones for containers that should be removed from a local sync
 * view. This is intentionally scoped to a user because removals caused by
 * access changes are visibility decisions, not global object deletion facts.
 *
 * The parent-lane index mirrors the live container scan so a client can request
 * tombstones for the same parent container watermark it uses for live rows. A
 * separate root-discovery marker covers directly granted non-root containers,
 * which are discoverable from root even though their stored `parentId` is the
 * real parent lane.
 */
export const containerSyncTombstones = pgTable(
  "container_sync_tombstones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    containerId: uuid("container_id").notNull(),
    parentId: uuid("parent_id"),
    depth: integer("depth").notNull(),
    reason: text("reason").$type<ContainerSyncTombstoneReason>().notNull(),
    rootDiscoveryVisible: boolean("root_discovery_visible")
      .default(false)
      .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_sync_tombstones_user_container_idx").on(
      table.userId,
      table.containerId,
    ),
    index("container_sync_tombstones_user_parent_updated_idx").on(
      table.userId,
      table.parentId,
      table.updatedAt,
      table.containerId,
    ),
    index("container_sync_tombstones_user_root_updated_idx").on(
      table.userId,
      table.rootDiscoveryVisible,
      table.updatedAt,
      table.containerId,
    ),
  ],
);

/**
 * Basic group catalog rows.
 *
 * Groups are managed recipient principals. This table keeps the lightweight
 * group identity/name record; signed group membership, roles, and key material
 * live in `principalStates`, `principalMembershipProjection`, and
 * `principalEpochKeys`.
 *
 * Columns:
 * - `id`: Stable group id.
 * - `organizationId`: Organization that owns the group, when the group is
 *   organization-scoped.
 * - `name`: Human-readable group name.
 * - `createdAt`: Server-side insertion timestamp.
 */
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
 *   state describes.
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
    principalId: uuid("principal_id").notNull(),
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
    principalId: uuid("principal_id").notNull(),
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

/**
 * Queryable membership and role projection for signed principal states.
 *
 * The signed principal state header stores a `projectionRoot`: a canonical hash
 * of the normalized projection members. This table stores the rows behind that
 * root so the server can answer authorization questions without decrypting the
 * private policy payload. On write, the submitted projection is hashed and must
 * match `principalStates.projectionRoot`; after insertion, the stored rows are
 * compared back to the submitted projection to make retries idempotent and
 * detect conflicts.
 *
 * A projection row says that, for one exact principal state hash, a direct
 * member principal has a role. It is historical rather than mutable: successor
 * principal states write new rows under a new `stateHash`, and callers use the
 * current state's hash when they need current membership.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is the tuple
 *   `(principalType, principalId, stateHash, memberPrincipalType,
 *   memberPrincipalId)`.
 * - `principalType`: Managed principal kind whose state owns this projection,
 *   currently `organization` or `group`.
 * - `principalId`: Stable id of the managed principal whose members are being
 *   projected.
 * - `stateHash`: Content address of the signed principal state header this
 *   projection belongs to. This joins the rows to `principalStates` and scopes
 *   membership to a specific historical version.
 * - `memberPrincipalType`: Kind of direct member in the projection, currently
 *   `user` or `group`.
 * - `memberPrincipalId`: Stable id of the direct member principal.
 * - `role`: Authorization role for that member in this principal state,
 *   currently `member` or `admin`. Admin membership authorizes signing
 *   successor principal states.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the signed
 *   projection root.
 *
 * Indexes:
 * - `(principalType, principalId)` supports loading current or historical
 *   projection rows for a principal.
 * - `(principalType, principalId, stateHash, memberPrincipalType,
 *   memberPrincipalId)` is unique so a state cannot contain duplicate rows for
 *   the same direct member. The role is intentionally not part of the unique
 *   key; a replay that changes only `role` is a projection conflict.
 */
export const principalMembershipProjection = pgTable(
  "principal_membership_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    memberPrincipalType: text("member_principal_type")
      .$type<PrincipalStateMemberType>()
      .notNull(),
    memberPrincipalId: uuid("member_principal_id").notNull(),
    role: text("role").$type<PrincipalProjectionRole>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_membership_projection_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    index("principal_membership_projection_member_idx").on(
      table.memberPrincipalType,
      table.memberPrincipalId,
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

/**
 * Recipient key material for managed principal key epochs.
 *
 * A principal state has a `keyEpoch`, `encapsulationPublicKey`, and
 * `keyFingerprint`. This table indexes that key material by principal and
 * epoch so other systems can encrypt to the principal as a recipient. For
 * example, a group member envelope can target a nested group by looking up the
 * nested group's current principal epoch key.
 *
 * Key epochs are historical and monotonic. Additive policy changes may reuse an
 * existing epoch and key material; membership shrink or key material changes
 * require a new epoch. Replays for an existing epoch must provide matching key
 * material.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(principalType, principalId, epoch)`.
 * - `principalType`: Managed principal kind whose recipient key this is,
 *   currently `organization` or `group`.
 * - `principalId`: Stable id of the managed principal.
 * - `epoch`: Principal key epoch. Current recipient lookup uses the highest
 *   epoch for the principal.
 * - `introducedByStateHash`: State hash of the first signed principal state
 *   that introduced this epoch. If later state versions reuse the same epoch,
 *   this remains pointed at the original introducing state.
 * - `encapsulationPublicKey`: Public KEM key for this principal epoch.
 * - `keyFingerprint`: Fingerprint of `encapsulationPublicKey`; copied from the
 *   verified signed state and used by writers to confirm they wrapped to the
 *   expected recipient key.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the signed
 *   principal state or key fingerprint.
 *
 * Indexes:
 * - `(principalType, principalId)` supports current-key lookup by ordering
 *   epochs descending.
 * - `(principalType, principalId, epoch)` is unique because each epoch has one
 *   accepted key. A replay for the same epoch must match the stored key
 *   material.
 */
export const principalEpochKeys = pgTable(
  "principal_epoch_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
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

/**
 * Wrapped principal key material for the current direct members of a principal.
 *
 * Principal state defines who the direct members are, and
 * `principalMembershipProjection` makes that membership queryable. This table
 * stores the encrypted key envelopes that let each direct member open the
 * managed principal's current key material. User members use their row in
 * `users` as the recipient key source; group members use their current
 * `principalEpochKeys` row.
 *
 * Envelopes are scoped to an exact `stateHash`. Replacing envelopes verifies
 * that the requested state is still current, that every current direct member
 * is covered exactly once, and that each submitted `memberKeyFingerprint`
 * matches the expected recipient key. This lets clients refresh wrapping
 * material without changing the signed principal state.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(principalType, principalId, stateHash, memberPrincipalType,
 *   memberPrincipalId)`.
 * - `principalType`: Managed principal kind whose key material is wrapped,
 *   currently `organization` or `group`.
 * - `principalId`: Stable id of the managed principal whose key is being
 *   distributed.
 * - `stateHash`: Current principal state hash these envelopes target. The row
 *   set must match the direct members projected for this state.
 * - `epoch`: Principal key epoch being wrapped. This is the owning principal's
 *   epoch, not the member recipient's epoch.
 * - `memberPrincipalType`: Direct member recipient kind, currently `user` or
 *   `group`.
 * - `memberPrincipalId`: Stable id of the direct member recipient.
 * - `memberKeyFingerprint`: Recipient key fingerprint used for this envelope.
 *   For users this is `users.encapsulationKeyFingerprint`; for groups this is
 *   the group's current `principalEpochKeys.keyFingerprint`.
 * - `kemCipherText`: KEM ciphertext/capsule produced while encrypting to the
 *   member recipient key.
 * - `wrappedKey`: Encrypted principal key material for the member recipient.
 * - `createdAt`: Server-side insertion timestamp. It is not signed policy
 *   state.
 *
 * Indexes:
 * - `(principalType, principalId)` supports loading current envelopes after the
 *   current state hash is resolved.
 * - `(principalType, principalId, stateHash, memberPrincipalType,
 *   memberPrincipalId)` is unique so one state has at most one envelope per
 *   direct member.
 */
export const principalMemberEnvelopes = pgTable(
  "principal_member_envelopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    epoch: integer("epoch").notNull(),
    memberPrincipalType: text("member_principal_type")
      .$type<PrincipalStateMemberType>()
      .notNull(),
    memberPrincipalId: uuid("member_principal_id").notNull(),
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

/**
 * Signed access events that drive access manifest history.
 *
 * An access event is the signed action record for a container/document access
 * mutation: create, grant/share, revoke, rekey, move, document link, document
 * unlink, and related access changes. The event header is signed by a user key,
 * the event body is stored alongside it, and `bodyHash` binds that body to the
 * signed header. Verified events are content-addressed by `eventHash`; access
 * manifests reference that hash in their own signed state.
 *
 * This table is append-only in practice. Inserts are idempotent by `eventHash`:
 * replaying the same verified event is accepted, while conflicting data for an
 * existing hash is rejected by the store.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is `eventHash`;
 *   `eventId` is also unique as a client-generated event identifier.
 * - `version`: Access event wire format version.
 * - `eventId`: Client-generated stable event id. It prevents reusing one
 *   logical event id for different content.
 * - `eventType`: Kind of access mutation represented by the event.
 * - `objectKind`: Kind of object the event mutates, for example `container` or
 *   `document`.
 * - `objectId`: Stable id of the object being mutated.
 * - `organizationId`: Organization boundary for the mutated object.
 * - `previousManifestHash`: Previous access manifest hash for successor
 *   events, or `null` for initial/create events.
 * - `dependencyManifestHashes`: Signed manifest dependencies needed to verify
 *   the event in context, such as parent/container path manifests or other
 *   authorization dependencies. The dependency projection table expands this
 *   JSON array for indexed lookups.
 * - `bodyHash`: Hash of `body`; included in the signed event header.
 * - `body`: Canonical JSON event body. The server stores it so it can return
 *   complete event/manifest bundles and regenerate projections.
 * - `eventHash`: Hash of the normalized signed event header. This is the stable
 *   content address referenced by `accessManifests.eventHash`.
 * - `signerUserId`: User id that signed the event.
 * - `signerDeviceId`: Client/device id included in the signed event header.
 * - `signerKeyFingerprint`: User signing key fingerprint used to verify
 *   `signature`.
 * - `signature`: Signature over the normalized unsigned event header.
 * - `signedAt`: Client-supplied timestamp included in the signed event header.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the signed
 *   event or `eventHash`.
 *
 * Indexes:
 * - `eventId` is unique to reject accidental reuse of a client event id.
 * - `eventHash` is unique because it is the content address for verified
 *   events.
 * - `(objectKind, objectId)` supports object-history and projection queries.
 * - `(signerUserId, signerKeyFingerprint)` supports signer-oriented audits or
 *   lookups.
 */
export const accessEvents = pgTable(
  "access_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").$type<AccessEventType>().notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    previousManifestHash: text("previous_manifest_hash"),
    dependencyManifestHashes: jsonb("dependency_manifest_hashes")
      .$type<string[]>()
      .notNull(),
    bodyHash: text("body_hash").notNull(),
    body: jsonb("body").$type<KeyingCanonicalJson>().notNull(),
    eventHash: text("event_hash").notNull(),
    signerUserId: uuid("signer_user_id").notNull(),
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

/**
 * Content-addressed access manifests for containers and document link sets.
 *
 * An access manifest is the verified access state produced from an
 * `accessEvents` row. It is the durable history for an access-controlled
 * object: each epoch commits the object identity, previous manifest link,
 * originating event, structural state, direct grant state, referenced principal
 * policy heads, and access-key target state. The crypto layer derives
 * `manifestHash` from the normalized manifest fields; the store persists the
 * object-specific verifier `state` alongside those fields so APIs can return
 * complete manifest bundles without re-deriving state from event bodies.
 *
 * This table is append-only in practice. Inserts are idempotent by
 * `manifestHash`: replaying the same verified manifest is accepted, while
 * conflicting data for an existing hash is rejected. Separate projection tables
 * expand dependencies such as referenced principal heads and document link-set
 * container membership for indexed reads.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is `manifestHash`.
 * - `version`: Access manifest wire format version.
 * - `objectKind`: Kind of object whose access state this manifest describes,
 *   currently container or document link-set access state.
 * - `objectId`: Stable id of the object whose access state this manifest
 *   describes.
 * - `organizationId`: Organization boundary for the object.
 * - `epoch`: Monotonic access-manifest version for this object. One object can
 *   have only one accepted manifest per epoch.
 * - `previousManifestHash`: Previous manifest in the object's hash chain, or
 *   `null` for the initial manifest.
 * - `eventHash`: Hash of the signed access event that produced this manifest.
 *   It joins to `accessEvents.eventHash`.
 * - `structuralHash`: Hash of object-specific structural state. For containers
 *   this includes parent/metadata fields; for document link sets this includes
 *   linked container ids.
 * - `grantRoot`: Hash commitment for direct access grants. Container manifests
 *   commit their direct grants here; document link-set manifests currently use
 *   the empty document-link-set grant root.
 * - `referencedPrincipalHeads`: Principal policy heads that were verified and
 *   committed while deriving this manifest. These heads are expanded into
 *   `accessManifestPrincipalHeadProjection`.
 * - `keyTargetHash`: Hash commitment for access-key target state. Container
 *   manifests commit the container key epoch; document link-set manifests
 *   commit the "current linked container KEKs" target mode.
 * - `manifestHash`: Content hash of the normalized access manifest. This is the
 *   stable reference used by current heads, dependencies, content-key bundles,
 *   and API manifest bundles.
 * - `state`: Object-specific verified state used to rehydrate a complete
 *   container/document manifest bundle. It is checked for consistency on
 *   replay but is not the generic access manifest itself.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the
 *   manifest hash.
 *
 * Indexes:
 * - `manifestHash` is unique because it is the content address.
 * - `eventHash` is unique because one verified access event produces one
 *   accepted manifest.
 * - `(objectKind, objectId, epoch)` is unique so an object cannot fork at the
 *   same epoch.
 * - `(objectKind, objectId)` supports object-history and current-head
 *   validation queries.
 */
export const accessManifests = pgTable(
  "access_manifests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: integer("version").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
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

/**
 * Current access manifest pointer for each access-controlled object.
 *
 * `accessManifests` stores the full append-only history. This table stores the
 * current head for each `(objectKind, objectId)` so callers can validate stale
 * writes and resolve current access state without scanning history.
 *
 * Head advancement is monotonic by `epoch`: storing a manifest with a higher
 * epoch updates the head, replaying the same epoch/hash is idempotent, and a
 * different manifest hash for the same epoch is treated as a conflict. Older
 * epochs do not move the head backward.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(objectKind, objectId)`.
 * - `objectKind`: Kind of object whose current access head this row tracks.
 * - `objectId`: Stable id of the object whose current access head this row
 *   tracks.
 * - `organizationId`: Organization boundary copied from the current manifest.
 * - `epoch`: Epoch of the current access manifest.
 * - `manifestHash`: Current manifest hash for the object. Joins to
 *   `accessManifests.manifestHash`.
 * - `updatedAt`: Server-side timestamp for the latest head write.
 *
 * Indexes:
 * - `(objectKind, objectId)` is unique because each object has one current
 *   access head.
 * - `manifestHash` supports reverse lookups from a manifest to the current-head
 *   rows that reference it.
 */
export const accessManifestHeads = pgTable(
  "access_manifest_heads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
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

/**
 * Container key-encryption-key epochs.
 *
 * A container KEK epoch represents the key material used to wrap document/blob
 * content keys for a container at a particular access-manifest state. The row
 * stores the verified container key-epoch header; the encrypted recipient
 * envelopes for that epoch live in `containerKeyWraps`.
 *
 * Key epochs are monotonic per container. Additive access changes may keep the
 * same epoch and refresh wraps, while revokes, rekeys, parent-key changes, or
 * other changes that require new key material advance the epoch.
 *
 * Columns:
 * - `id`: Crypto-level container key epoch id. This is the primary key and is
 *   referenced by content-key target rows. New app-created ids may use the
 *   `tearleads.container-kek.v1.sha256:<hash>` format, which lets clients
 *   verify unwrapped KEK material against the signed epoch id.
 * - `containerId`: Container whose KEK this epoch belongs to.
 * - `keyEpoch`: Monotonic numeric key epoch for the container.
 * - `accessManifestHash`: Container access manifest hash that this KEK state
 *   was verified against.
 * - `parentContainerKeyEpochId`: Parent container KEK epoch inherited by this
 *   container, or `null` for root containers.
 * - `createdByEventHash`: Access event hash that introduced this KEK state.
 * - `createdByManifestHash`: Access manifest hash produced by that event.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(containerId, keyEpoch)` is unique because a container can have one
 *   accepted KEK row per epoch.
 * - `containerId` supports current epoch lookup by ordering `keyEpoch`
 *   descending.
 * - `accessManifestHash` supports loading the KEK state for a manifest.
 * - `parentContainerKeyEpochId` supports inherited-key edge validation.
 */
export const containerKeyEpochs = pgTable(
  "container_key_epochs",
  {
    id: text("id").primaryKey(),
    containerId: uuid("container_id").notNull(),
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

/**
 * Recipient envelopes for a container KEK epoch.
 *
 * Each row stores one encrypted wrap of a container KEK to a recipient
 * principal. User recipients are backed by `users`; managed recipients such as
 * organizations and groups are backed by `principalEpochKeys`. The verifier
 * treats the wrap set for a current KEK state as exact, so stale rows are
 * removed when a same-epoch recipient target is replaced.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `containerKeyEpochId`: Container KEK epoch whose key material is wrapped.
 * - `recipientKind`: Recipient principal kind for the envelope.
 * - `recipientId`: Stable id of the recipient principal.
 * - `recipientKeyEpochId`: Recipient key epoch identifier used to encrypt the
 *   wrap. User recipient records supply this value and are checked by
 *   fingerprint; managed principal recipient ids are derived from their
 *   referenced principal head.
 * - `recipientKeyFingerprint`: Fingerprint of the recipient public key used for
 *   verification.
 * - `kemCipherText`: KEM ciphertext/capsule for principal recipients, or the
 *   AES-GCM IV for parent-container recipients. Principal wraps use
 *   `tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm`; parent-container
 *   wraps use `tearleads.container-kek-wrap.aes-256-gcm-parent-kek`.
 * - `wrappedKey`: Encrypted container KEK material for this recipient.
 * - `wrapManifestHash`: Access manifest hash whose current target set
 *   authorized this wrap.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(containerKeyEpochId, recipientKind, recipientId,
 *   recipientKeyEpochId)` is unique so one recipient key has one wrap for an
 *   epoch.
 * - `containerKeyEpochId` supports loading the full wrap set for an epoch.
 * - `(recipientKind, recipientId)` supports recipient-oriented lookup.
 * - `wrapManifestHash` supports diagnostics and manifest-based queries.
 */
export const containerKeyWraps = pgTable(
  "container_key_wraps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    containerKeyEpochId: text("container_key_epoch_id").notNull(),
    recipientKind: text("recipient_kind").$type<KekRecipientKind>().notNull(),
    recipientId: uuid("recipient_id").notNull(),
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

/**
 * Indexed dependency hashes for signed access events.
 *
 * This is a derived cache. The source of authority is
 * `accessEvents.dependencyManifestHashes`, and authorization must verify the
 * signed event/manifest bundle rather than trusting projection rows alone.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `eventHash`: Access event whose dependency array this row expands.
 * - `objectKind`: Object kind copied from the event for scoped lookup.
 * - `objectId`: Object id copied from the event for scoped lookup.
 * - `dependencyManifestHash`: One dependency manifest hash referenced by the
 *   event.
 * - `dependencyIndex`: Position of the dependency in the signed dependency
 *   array, preserving deterministic order for bundle reconstruction.
 * - `createdAt`: Server-side projection timestamp.
 *
 * Indexes:
 * - `eventHash` supports regenerating and loading dependencies for an event.
 * - `dependencyManifestHash` supports reverse dependency lookup.
 * - `(eventHash, dependencyManifestHash)` is unique so one dependency appears
 *   once per event.
 */
export const accessEventDependencyProjection = pgTable(
  "access_event_dependency_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventHash: text("event_hash").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
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

/**
 * Indexed referenced-principal heads for an access manifest.
 *
 * This is a derived cache over `accessManifests.referencedPrincipalHeads`.
 * Container/document access verification still checks the signed source
 * manifest and the referenced principal policy heads. The projection exists so
 * reads can find manifests involving a principal without scanning JSON.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `manifestHash`: Access manifest whose principal-head array this row
 *   expands.
 * - `objectKind`: Object kind copied from the manifest.
 * - `objectId`: Object id copied from the manifest.
 * - `principalType`: Referenced managed principal kind.
 * - `principalId`: Referenced principal id.
 * - `version`: Principal state version committed by the manifest.
 * - `keyEpoch`: Principal key epoch committed by the manifest.
 * - `stateHash`: Principal state hash committed by the manifest.
 * - `keyFingerprint`: Principal key fingerprint committed by the manifest.
 * - `createdAt`: Server-side projection timestamp.
 *
 * Indexes:
 * - `manifestHash` supports loading all principal heads for a manifest.
 * - `(principalType, principalId)` supports principal-oriented lookup.
 * - `(manifestHash, principalType, principalId)` is unique because a manifest
 *   references one current head per principal.
 */
export const accessManifestPrincipalHeadProjection = pgTable(
  "access_manifest_principal_head_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    objectKind: text("object_kind").$type<AccessObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
    principalType: text("principal_type")
      .$type<ManagedPrincipalKind>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
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

/**
 * Indexed document-to-container links committed by a document manifest.
 *
 * This is a derived cache. The signed document link-set manifest is the source
 * of authority for document links; this projection lets services list documents
 * in a container and resolve current blob/document KEK targets efficiently.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `manifestHash`: Document link-set access manifest whose linked-container
 *   set this row expands.
 * - `documentId`: Document described by the link-set manifest.
 * - `containerId`: Linked container id from the manifest state.
 * - `createdAt`: Server-side projection timestamp.
 *
 * Indexes:
 * - `manifestHash` supports loading the full link set for a manifest.
 * - `documentId` supports document-oriented link queries.
 * - `containerId` supports listing manifest-linked documents in a container.
 * - `(manifestHash, containerId)` is unique because one manifest links a
 *   container at most once.
 */
export const accessManifestDocumentLinkProjection = pgTable(
  "access_manifest_document_link_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    documentId: uuid("document_id").notNull(),
    containerId: uuid("container_id").notNull(),
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

/**
 * Expanded direct grants for container access manifests.
 *
 * The signed manifest remains the source of truth. This projection gives sync
 * and read paths an indexed way to discover current direct access seeds without
 * scanning JSON manifest state.
 */
export const accessManifestContainerGrantProjection = pgTable(
  "access_manifest_container_grant_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    containerId: uuid("container_id").notNull(),
    accessLevel: text("access_level").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("access_manifest_container_grant_manifest_idx").on(
      table.manifestHash,
    ),
    index("access_manifest_container_grant_subject_idx").on(
      table.subjectType,
      table.subjectId,
    ),
    index("access_manifest_container_grant_container_idx").on(
      table.containerId,
    ),
    uniqueIndex("access_manifest_container_grant_unique_idx").on(
      table.manifestHash,
      table.subjectType,
      table.subjectId,
      table.accessLevel,
    ),
  ],
);

/**
 * Organization-defined container grants that product workflows treat as
 * built-in.
 *
 * The signed access manifest remains the source of authority for whether the
 * grant is active. This table records immutable product policy for grants that
 * should not be modified or revoked through normal container mutation flows.
 * Registration seeds the bootstrap Admins -> root container admin grant here.
 */
export const containerBuiltinGrants = pgTable(
  "container_builtin_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    containerId: uuid("container_id").notNull(),
    accessLevel: text("access_level").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("container_builtin_grants_org_idx").on(table.organizationId),
    uniqueIndex("container_builtin_grants_identity_idx").on(
      table.containerId,
      table.subjectType,
      table.subjectId,
    ),
  ],
);

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
 * domain, writer, and ciphertext hash. Replays for the same `updateId` are
 * accepted only when the computed `headerHash` matches the stored value.
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

/**
 * Content-key epochs for encrypted blob payloads.
 *
 * A blob content-key bundle says which symmetric content key protects a blob
 * and which current attachment/container KEK targets can unwrap it. Blobs are
 * immutable in this model, so the store currently accepts only content key
 * epoch `1`; if targets shrink, callers replace the blob instead of rotating
 * its content key in place.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Target rows reference this id.
 *   Domain identity is `(blobId, contentKeyEpoch)`.
 * - `blobId`: Blob whose encrypted content key this bundle describes.
 * - `contentKeyEpoch`: Blob content-key epoch. Currently must be `1`.
 * - `targetHash`: Hash of the normalized target rows in
 *   `blobContentKeyTargets`.
 * - `createdAt`: Server-side insertion timestamp for the epoch row.
 * - `updatedAt`: Server-side timestamp for target-hash refreshes, such as
 *   additive attachment target growth.
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

/**
 * Current materialized document-to-container links.
 *
 * Document link authority comes from signed document link-set manifests and the
 * per-manifest projection in `accessManifestDocumentLinkProjection`. This table
 * stores the current link set for the document row itself so document workflows
 * can update the structural projection by deleting and reinserting the current
 * linked containers.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `documentId`: Document whose current linked containers are projected.
 * - `containerId`: Currently linked container id.
 * - `createdAt`: Server-side insertion timestamp for the projected link row.
 *
 * Indexes:
 * - `(documentId, containerId)` is unique so a document links a container at
 *   most once in the current projection.
 * - `containerId` supports container-oriented document listing.
 */
export const documentContainerLinks = pgTable(
  "document_container_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
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

/**
 * Per-container document unlink tombstones for differential document discovery.
 *
 * A row means the document is no longer currently linked to the container as of
 * `updatedAt`. If the document is linked again later, the current document row
 * will carry a newer sync timestamp and wins in client application order.
 */
export const containerDocumentSyncTombstones = pgTable(
  "container_document_sync_tombstones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    containerId: uuid("container_id").notNull(),
    documentId: uuid("document_id").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("container_document_sync_tombstones_unique_idx").on(
      table.containerId,
      table.documentId,
    ),
    index("container_document_sync_tombstones_container_updated_idx").on(
      table.containerId,
      table.updatedAt,
      table.documentId,
    ),
  ],
);

/**
 * One-to-one container metadata document bindings.
 *
 * Every created container can have a metadata document that describes
 * user-facing container metadata through the regular encrypted document path.
 * Metadata documents cannot be structurally relinked as normal documents, so
 * this binding lets document mutation workflows reject relinks for metadata
 * documents.
 *
 * Columns:
 * - `containerId`: Container whose metadata document this row binds. This is
 *   the primary key because a container has one metadata document.
 * - `documentId`: Metadata document id. It is unique so one document cannot be
 *   reused as metadata for multiple containers.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const containerMetadataDocuments = pgTable(
  "container_metadata_documents",
  {
    containerId: uuid("container_id").primaryKey(),
    documentId: uuid("document_id").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

/**
 * Hash-chained checkpoint records for document audit history.
 *
 * Document update sync can mark selected Loro updates as checkpoints. A
 * checkpoint records the baseline update id, source version vector, the latest
 * covered audit entry hash, the previous checkpoint hash, and the access state
 * under which the checkpoint was written. The computed `checkpointHash` chains
 * those fields for later audit-history verification.
 *
 * Columns:
 * - `id`: Surrogate database primary key.
 * - `documentId`: Document whose audit checkpoint this row describes.
 * - `sequence`: Database-generated monotonic sequence used to order
 *   checkpoints. Queries scope the ordering by `documentId`.
 * - `baselineUpdateId`: Live document update id that carries the checkpoint
 *   baseline. Unique so the same update cannot create multiple checkpoints.
 * - `checkpointKind`: Loro checkpoint kind supplied by the update metadata.
 * - `sourceVersionVector`: Loro source version vector covered by the
 *   checkpoint.
 * - `coveredAuditEntryHash`: Latest document audit entry hash covered by this
 *   checkpoint, or `null` when no entry was covered.
 * - `previousCheckpointHash`: Previous checkpoint hash for the document, or
 *   `null` for the first checkpoint.
 * - `checkpointHash`: Hash over the checkpoint fields and previous checkpoint
 *   pointer.
 * - `accessEpoch`: Access manifest epoch active when the checkpoint was
 *   written.
 * - `accessManifestHash`: Access manifest hash active when the checkpoint was
 *   written.
 * - `accessStateHash`: Optional object-specific access state hash included in
 *   the checkpoint hash when present.
 * - `actorUserId`: User who wrote the checkpoint update.
 * - `actorFingerprint`: Signing key fingerprint for `actorUserId`.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(documentId, sequence)` supports ordered checkpoint verification.
 * - `(documentId, checkpointHash)` is unique so one document cannot store
 *   conflicting rows for the same checkpoint hash.
 * - `(documentId, createdAt)` supports time-oriented audit lookup.
 */
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

/**
 * Hash-chained document audit entries.
 *
 * This table stores the common audit envelope for auditable document actions.
 * Event-specific details live in companion tables such as
 * `documentUpdateAuditEvents` and `documentAttachmentAuditEvents`. The
 * `entryHash` commits the common fields, the event-specific fields, and the
 * previous entry hash so verifiers can replay the document's audit chain.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Companion event tables reference this
 *   id as their primary key.
 * - `documentId`: Document whose audit history this row belongs to.
 * - `sequence`: Database-generated monotonic sequence used to order entries.
 *   Queries scope the ordering by `documentId`.
 * - `eventType`: Audit event family, for example `loro_update` or
 *   `attachment_event`.
 * - `accessEpoch`: Access manifest epoch active when the event was written.
 * - `accessManifestHash`: Access manifest hash active when the event was
 *   written.
 * - `accessStateHash`: Optional object-specific access state hash included in
 *   the entry hash when present.
 * - `actorUserId`: User who performed the audited action.
 * - `actorFingerprint`: Signing key fingerprint for `actorUserId`.
 * - `prevEntryHash`: Previous audit entry hash for the document, or `null` for
 *   the first entry.
 * - `entryHash`: Hash over the common fields, event-specific fields, and
 *   previous entry pointer.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `(documentId, sequence)` is unique and supports ordered audit replay.
 * - `(documentId, entryHash)` is unique so a document stores one row per audit
 *   hash.
 * - `(documentId, createdAt)` supports time-oriented audit lookup.
 */
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

/**
 * Event-specific audit details for encrypted document updates.
 *
 * The common audit envelope lives in `documentAuditEntries` with event type
 * `loro_update`. This table adds the live update id, Loro version-vector
 * boundaries, and ciphertext digest metadata needed to verify the update audit
 * hash and correlate audit history with stored document updates.
 *
 * Columns:
 * - `auditEntryId`: Primary key and foreign key to the common audit entry.
 * - `liveUpdateId`: Id of the live document update row. Unique so one update is
 *   audited once.
 * - `partialStartVersionVector`: Loro version vector before applying the
 *   partial update.
 * - `partialEndVersionVector`: Loro version vector after applying the partial
 *   update.
 * - `sourceVersionVector`: Optional source version vector supplied by the
 *   client.
 * - `encryptedUpdateSha256`: SHA-256 digest of the encrypted update payload.
 * - `encryptedUpdateByteLength`: Byte length of the encrypted update payload.
 */
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

/**
 * Blob metadata retained for document attachment audit history.
 *
 * Attachment audit entries may need to reference blobs after the live blob
 * lifecycle changes. This table stores immutable audit metadata for each
 * referenced blob: digest, byte length, live storage key if the live object is
 * still present, and retention/pruning state for historical bytes.
 *
 * Columns:
 * - `blobId`: Primary key matching the committed blob id.
 * - `sha256`: SHA-256 digest of the encrypted blob bytes.
 * - `byteLength`: Byte length of the encrypted blob bytes.
 * - `liveStorageKey`: Storage key for the live blob object when available.
 * - `retentionMode`: Retention policy for the audited blob metadata. Currently
 *   only `live_only` is supported.
 * - `historicalBytesRetained`: Whether historical encrypted bytes are retained
 *   outside the live blob object.
 * - `prunedAt`: Timestamp when historical bytes were pruned, if applicable.
 * - `createdAt`: Server-side insertion timestamp.
 */
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

/**
 * Event-specific audit details for document attachment changes.
 *
 * The common audit envelope lives in `documentAuditEntries` with event type
 * `attachment_event`. This table adds the attachment slot, binding/blob ids,
 * prior binding/blob ids for replacements or detaches, and the blob retention
 * mode committed into the audit hash.
 *
 * Columns:
 * - `auditEntryId`: Primary key and foreign key to the common audit entry.
 * - `action`: Attachment action, currently `attach`, `replace`, `detach`, or
 *   `rewrap`.
 * - `slotId`: Logical attachment slot within the document.
 * - `bindingId`: New/current attachment binding id, when the action creates or
 *   references one.
 * - `previousBindingId`: Previous binding id for replacement or detach flows.
 * - `blobId`: New/current blob id for attach or replace flows.
 * - `previousBlobId`: Previous blob id for replacement or detach flows.
 * - `retentionMode`: Blob audit retention mode committed into the entry hash.
 */
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

/**
 * Committed encrypted blob payloads.
 *
 * A blob row stores encrypted bytes after a staged upload has been promoted by
 * an authorized attachment mutation. Access to bytes is checked through current
 * attachment bindings and document/container access before the row is returned.
 *
 * Columns:
 * - `id`: Stable blob id.
 * - `storageKey`: Storage key for the encrypted bytes.
 * - `encryptedBytes`: Legacy encrypted blob payload bytes encoded as a string,
 *   or a metadata pointer for object-store-backed multipart uploads.
 * - `sha256`: SHA-256 digest of `encryptedBytes`.
 * - `byteLength`: Byte length of `encryptedBytes`.
 * - `createdAt`: Server-side promotion timestamp.
 */
export const blobs = pgTable("blobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  storageKey: text("storage_key").notNull(),
  encryptedBytes: text("encrypted_bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Temporary encrypted blob uploads awaiting attachment mutation.
 *
 * Staging lets a user upload encrypted bytes and receive a stage id before the
 * authorized attachment mutation promotes those bytes into `blobs`. Promotion
 * requires the same owner user, a non-expired stage, and matching blob write
 * header/ciphertext hash. Promoted stages are deleted.
 *
 * Columns:
 * - `id`: Stage id returned to the client.
 * - `ownerUserId`: User who created the stage and is allowed to promote it.
 * - `encryptedBytes`: Legacy encrypted blob payload bytes encoded as a string,
 *   or multipart stage metadata for object-store-backed uploads.
 * - `sha256`: SHA-256 digest of `encryptedBytes`.
 * - `byteLength`: Byte length of `encryptedBytes`.
 * - `expiresAt`: Expiration timestamp after which promotion is rejected.
 * - `createdAt`: Server-side staging timestamp.
 */
export const blobStages = pgTable("blob_stages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  encryptedBytes: text("encrypted_bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Materialized attachment bindings between documents, slots, and blobs.
 *
 * Attachment bindings are written from verified attachment access events. A
 * binding attaches a blob to one logical document slot; replacing a slot points
 * at the previous binding, and detaching marks the active binding with
 * `detachedAt`. The partial unique index enforces one active binding per
 * document slot.
 *
 * Columns:
 * - `id`: Stable attachment binding id.
 * - `documentId`: Document that owns the attachment slot.
 * - `slotId`: Logical attachment slot within the document.
 * - `blobId`: Blob attached to the slot.
 * - `previousBindingId`: Previous binding in the slot chain for replacement
 *   flows, or `null` for the first binding.
 * - `attachmentEventHash`: Access event hash that created this binding.
 * - `documentManifestHash`: Document link-set manifest hash verified for the
 *   binding.
 * - `detachedAt`: Timestamp when this binding was detached, or `null` while it
 *   is active.
 * - `createdAt`: Server-side insertion timestamp.
 *
 * Indexes:
 * - `documentId` supports document attachment listing.
 * - `blobId` supports resolving documents that currently expose a blob.
 * - `previousBindingId` supports slot-chain diagnostics.
 * - `attachmentEventHash` supports access-event correlation.
 * - `(documentId, slotId) where detachedAt is null` is unique so one document
 *   slot has at most one active binding.
 */
export const attachmentBindings = pgTable(
  "attachment_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
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
