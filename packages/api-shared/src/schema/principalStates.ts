import type {
  ManagedRecipientPrincipalType,
  PrincipalContainerGrantAccessLevel,
  PrincipalProjectionRole,
  PrincipalStateExternalAuthority,
  PrincipalStateMembershipMode,
  PrincipalStatePayloadCipherSuite,
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
 * - `memberEnvelopesRoot`: Canonical hash of the exact member key-envelope set
 *   signed by the principal state.
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
    memberEnvelopesRoot: text("member_envelopes_root").notNull(),
    projectionRoot: text("projection_root").notNull(),
    grantRoot: text("grant_root").notNull(),
    payloadCiphertextHash: text("payload_ciphertext_hash").notNull(),
    memberCount: integer("member_count").notNull(),
    grantCount: integer("grant_count").notNull(),
    externalAuthority:
      jsonb("external_authority").$type<PrincipalStateExternalAuthority>(),
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
 *   `(principalType, principalId, stateHash, userId)`.
 * - `principalType`: Managed principal kind whose state owns this projection,
 *   currently `organization` or `group`.
 * - `principalId`: Stable id of the managed principal whose members are being
 *   projected.
 * - `stateHash`: Content address of the signed principal state header this
 *   projection belongs to. This joins the rows to `principalStates` and scopes
 *   membership to a specific historical version.
 * - `userId`: Stable id of the direct member, always a user. Principals cannot
 *   contain other principals, so there is no member-kind column.
 * - `role`: Authorization role for that member in this principal state,
 *   currently `member` or `admin`. Admin membership authorizes signing
 *   successor principal states.
 * - `createdAt`: Server-side insertion timestamp. It is not part of the signed
 *   projection root.
 *
 * Indexes:
 * - `(principalType, principalId)` supports loading current or historical
 *   projection rows for a principal.
 * - `(principalType, principalId, stateHash, userId)` is unique so a state
 *   cannot contain duplicate rows for
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
    userId: uuid("user_id").notNull(),
    role: text("role").$type<PrincipalProjectionRole>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_membership_projection_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    index("principal_membership_projection_member_idx").on(table.userId),
    index("principal_membership_projection_member_state_idx").on(
      table.userId,
      table.principalType,
      table.principalId,
      table.stateHash,
    ),
    uniqueIndex("principal_membership_projection_state_member_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.userId,
    ),
  ],
);

/** Historical complete direct-container grant projection committed by a state. */
export const principalContainerGrantProjection = pgTable(
  "principal_container_grant_projection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    containerId: uuid("container_id").notNull(),
    accessLevel: text("access_level")
      .$type<PrincipalContainerGrantAccessLevel>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("principal_container_grant_projection_principal_idx").on(
      table.principalType,
      table.principalId,
    ),
    index("principal_container_grant_projection_container_idx").on(
      table.containerId,
    ),
    uniqueIndex("principal_container_grant_projection_state_container_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.containerId,
    ),
  ],
);

/**
 * Recipient key material for managed principal key epochs.
 *
 * A principal state has a `keyEpoch`, `encapsulationPublicKey`, and
 * `keyFingerprint`. This table indexes that key material by principal and
 * epoch so other systems can encrypt to the principal as a recipient. For
 * example, a container key wrap can target a group by looking up that group's
 * current principal epoch key.
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
 * Envelopes are immutable and scoped to an exact `stateHash`. Their canonical
 * exact root is signed into that state. Initial insertion verifies that every
 * direct member is covered exactly once and that each submitted fingerprint
 * matches the expected recipient key; exact retries are idempotent.
 *
 * Columns:
 * - `id`: Surrogate database primary key. Domain identity is
 *   `(principalType, principalId, stateHash, userId)`.
 * - `principalType`: Managed principal kind whose key material is wrapped,
 *   currently `organization` or `group`.
 * - `principalId`: Stable id of the managed principal whose key is being
 *   distributed.
 * - `stateHash`: Current principal state hash these envelopes target. The row
 *   set must match the direct members projected for this state.
 * - `epoch`: Principal key epoch being wrapped. This is the owning principal's
 *   epoch, not the member recipient's epoch.
 * - `userId`: Stable id of the direct member recipient, always a user.
 * - `memberKeyFingerprint`: Recipient key fingerprint used for this envelope.
 *   For users this is `users.encapsulationKeyFingerprint`; for groups this is
 *   the group's current `principalEpochKeys.keyFingerprint`.
 * - `kemCipherText`: KEM ciphertext/capsule produced while encrypting to the
 *   member recipient key.
 * - `wrappedKey`: Encrypted principal key material for the member recipient.
 * - `createdAt`: Server-side insertion timestamp. The row timestamp is not
 *   signed, but every cryptographic envelope field is.
 *
 * Indexes:
 * - `(principalType, principalId)` supports loading current envelopes after the
 *   current state hash is resolved.
 * - `(principalType, principalId, stateHash, userId)` is unique so one state
 *   has at most one envelope per
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
    userId: uuid("user_id").notNull(),
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
      table.userId,
    ),
  ],
);
