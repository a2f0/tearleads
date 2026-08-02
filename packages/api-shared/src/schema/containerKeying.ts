import type { KekRecipientKind } from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

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
 *   referenced by content-key target rows. App-created ids use the
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
    // The append-only bridge log: a successor epoch authenticates and
    // encrypts its immediate predecessor, written once at rotation and never
    // rewritten. This is the ground truth the sealed keyring snapshot is
    // rebuilt from; hot reads never walk it. Suite and version are persisted
    // per row so a future suite rotation is representable.
    predecessorContainerKeyEpochId: text("predecessor_container_key_epoch_id"),
    predecessorBridgeVersion: integer("predecessor_bridge_version"),
    predecessorBridgeSuite: text("predecessor_bridge_suite"),
    predecessorBridgeIv: text("predecessor_bridge_iv"),
    wrappedPredecessorKey: text("wrapped_predecessor_key"),
    // The snapshot: the container's complete predecessor key history sealed
    // under this epoch's KEK. Immutable per epoch; historical rows retain
    // their keyrings as the fallback ladder during rebuild.
    keyringIv: text("keyring_iv"),
    sealedKeyring: text("sealed_keyring"),
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
    uniqueIndex("container_key_epochs_predecessor_idx").on(
      table.predecessorContainerKeyEpochId,
    ),
    check(
      "container_key_epochs_rotation_artifacts_complete",
      sql`(
        (${table.predecessorContainerKeyEpochId} is null and ${table.predecessorBridgeVersion} is null and ${table.predecessorBridgeSuite} is null and ${table.predecessorBridgeIv} is null and ${table.wrappedPredecessorKey} is null and ${table.keyringIv} is null and ${table.sealedKeyring} is null)
        or
        (${table.predecessorContainerKeyEpochId} is not null and ${table.predecessorBridgeVersion} is not null and ${table.predecessorBridgeSuite} is not null and ${table.predecessorBridgeIv} is not null and ${table.wrappedPredecessorKey} is not null and ${table.keyringIv} is not null and ${table.sealedKeyring} is not null)
      )`,
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
