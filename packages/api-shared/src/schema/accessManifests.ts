import type {
  AccessObjectKind,
  KeyingCanonicalJson,
  ManagedPrincipalKind,
  ReferencedPrincipalHead,
} from "@symcrypt/crypto";
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
 * Durable proof that an authorized user was served a document manifest while
 * the document was live. Purge-proof retrieval accepts a historical checkpoint
 * only when this table shows the caller already knew that exact hash, preventing
 * the terminal proof endpoint from becoming a history-enumeration oracle.
 * These rows intentionally survive signed document purge.
 */
export const documentManifestObservations = pgTable(
  "document_manifest_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    documentId: uuid("document_id").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    observedAt: timestamp("observed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_manifest_observations_user_document_hash_idx").on(
      table.userId,
      table.documentId,
      table.manifestHash,
    ),
    index("document_manifest_observations_document_idx").on(table.documentId),
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
    index("access_manifest_document_link_container_manifest_idx").on(
      table.containerId,
      table.manifestHash,
      table.documentId,
    ),
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
    index("access_manifest_container_grant_subject_manifest_idx").on(
      table.subjectType,
      table.subjectId,
      table.manifestHash,
      table.containerId,
    ),
    index("access_manifest_container_grant_container_idx").on(
      table.containerId,
    ),
    index("access_manifest_container_grant_container_manifest_idx").on(
      table.containerId,
      table.manifestHash,
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
 * Organization-defined container grants whose subject and access level are
 * fixed product policy.
 *
 * The signed access manifest remains the source of authority for whether the
 * grant is active. A built-in grant cannot be revoked or assigned a different
 * access level through normal container mutation flows, but its cryptographic
 * wrap and referenced principal head may be refreshed at the same level after
 * a recipient key rotation. Registration seeds the bootstrap Admins -> root
 * container admin grant here.
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
