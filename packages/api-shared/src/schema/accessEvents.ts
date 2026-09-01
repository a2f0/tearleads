import type {
  AccessEventType,
  AccessObjectKind,
  KeyingCanonicalJson,
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
