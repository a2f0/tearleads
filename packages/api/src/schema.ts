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
