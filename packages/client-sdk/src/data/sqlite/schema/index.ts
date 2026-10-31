import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { containerDocumentTombstoneHolds } from "./containerDocumentTombstoneHoldSchema";
import {
  containerSQLiteSchema,
  containerTableSchemas,
} from "./containerSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "./documentAttachmentSchema";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "./documentDiscoveryEvidenceSchema";
import {
  documentOrphanBlobReclaims,
  documentOrphanBlobReclaimTable,
} from "./documentOrphanBlobReclaimSchema";
import { documentIntentLinkTargets } from "./documentPlacementIntentSchema";
import { localIntents } from "./localIntentSchema";
import * as organizationDataUsage from "./organizationDataUsageSchema";
import { organizationFounders } from "./organizationFounderSchema";
import * as provisioningAttempt from "./organizationProvisioningAttemptSchema";
import {
  organizationReadModelSQLiteSchema,
  organizationReadModelTables,
} from "./organizationReadModelTableRegistry";
import * as organizationSyncPause from "./organizationSyncPauseSchema";
import { principalGrantRetirements } from "./principalGrantRetirementSchema";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "./principalHistoryEvidenceSchema";
import {
  principalHistoryNodeReferences,
  principalHistoryRootOwners,
} from "./principalHistoryNodeRetentionSchema";
import { principalKeyEnvelopeArchive } from "./principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "./principalHistoryStageSchema";
import {
  principalMutationJournal,
  principalMutationJournalTables,
} from "./principalMutationJournalSchema";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "./principalPolicySchema";
import {
  securityIncidents,
  securityIncidentTable,
} from "./securityIncidentSchema";
import {
  verifiedAccessManifestBundles,
  verifiedManifestBundleTables,
} from "./verifiedManifestBundleSchema";

export {
  containerHydrationTombstones,
  containers,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
  supersededContainerBindings,
} from "./containerSchema";
export {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "./documentAttachmentSchema";
export {
  inContainerIntentLanes,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  LOCAL_INTENT_SUBJECT,
  localIntents,
} from "./localIntentSchema";
export {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "./principalPolicySchema";
export { securityIncidents } from "./securityIncidentSchema";
export { containerDocumentTombstoneHolds, organizationReadModelTables };

const accessLevelColumn = "effective_access_level";

/**
 * Durable Loro-backed document records shared by app features.
 *
 * This table stores encrypted document runtime state for multiple app domains.
 * `appKind` namespaces records for documents and container metadata. User-facing
 * list data is projected into feature-specific read models.
 *
 * Columns:
 * - `appKind`: Local domain namespace for the row, such as `documents` or
 *   `container-metadata`.
 * - `localId`: Stable local id inside `appKind`. It may be created before a
 *   server `documentId` exists.
 * - `documentId`: Server document id once the record is known remotely, or
 *   `null` while the document is local-only.
 * - `accessEpoch`: Latest access epoch persisted for the document. Defaults to
 *   the initial epoch.
 * - `accessStateHash`: Current document access/manifest state hash returned by
 *   sync, when known.
 * - `lastCommitLsn`: Last remote commit cursor applied to this local document.
 * - `documentManifestBundle`: Serialized document manifest bundle used for
 *   encrypted document sync.
 * - `contentKeyBundle`: Serialized content-key material needed to open the
 *   local document.
 * - `documentKekTargets`: Serialized KEK target state for document key wraps.
 * - `pendingBaseVersion`: Encoded oplog version through which every persisted
 *   op is already enqueued or synced. Persisted so a restart restores the
 *   outgoing-delta marker instead of re-seeding it past a device-first
 *   `deferRemoteSync` write's un-advanced op. `null` when unset.
 * - `snapshotEndVersion`: Encoded end version vector of the persisted content
 *   (which lives in the durable-history tables, never on this row), written on
 *   every content persist. Lets the pending-write queue's deferred-tail scan
 *   compare version coverage without loading content. Empty string when the
 *   document has never hydrated content, which readers treat as "no deferred
 *   tail claimable".
 * - `recoveryGeneration`: Atomic raw-history recovery writer fence.
 * - `recoveryDocumentId`: Former server id for cross-client post-purge recreation.
 * - `pullContinuation`: Durable progress for the next bounded remote pull.
 * - `syncFailureStatus`, `syncFailureMessage`, `syncFailureAttemptedAt`: The
 *   last terminal sync failure or quarantined incoming update for this scope.
 *   The durable write queue (queued rows of `documentHistoryUpdates`) has no
 *   status columns, so these let the write-queue view and footer explain why
 *   the document is blocked. `syncFailureMessage` is non-null exactly when a
 *   failure is recorded; a newer failure replaces the old, and a later fully
 *   validated sync pass, a remote reset, or the scope's teardown clears all
 *   three.
 * - `updatedAt`: Local timestamp for the last persisted runtime-state update.
 *
 * Indexes:
 * - `(appKind, localId)` is the primary key and scopes local document lookups.
 * - `(appKind, documentId) where documentId is not null` supports resolving a
 *   server document id back to the local row during discovery and relinking.
 */
export const documents = sqliteTable(
  "documents",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id"),
    accessEpoch: integer("access_epoch").notNull().default(1),
    accessStateHash: text("access_state_hash"),
    effectiveAccessLevel: text(accessLevelColumn).notNull().default("read"),
    lastCommitLsn: text("last_commit_lsn"),
    documentManifestBundle: text("document_manifest_bundle"),
    contentKeyBundle: text("content_key_bundle"),
    documentKekTargets: text("document_kek_targets"),
    pendingBaseVersion: text("pending_base_version"),
    pullContinuation: text("pull_continuation"),
    recoveryGeneration: integer("recovery_generation").notNull().default(0),
    recoveryDocumentId: text("recovery_document_id"),
    snapshotEndVersion: text("snapshot_end_version").notNull().default(""),
    syncFailureStatus: integer("sync_failure_status"),
    syncFailureMessage: text("sync_failure_message"),
    syncFailureAttemptedAt: text("sync_failure_attempted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId] }),
    index("documents_app_document_idx")
      .on(table.appKind, table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

/**
 * Full-history persistence for local documents (checkpoint + tail) — the ONLY
 * durable content source. Record rows in `documents` carry runtime metadata
 * and the content frontier (`snapshotEndVersion`), never content. The
 * checkpoint holds a full-history snapshot refreshed only at compaction, and
 * the tail appends every update (local deltas and decrypted remote updates)
 * written since. Restore = import checkpoint + replay tail; compaction =
 * export full history from the live doc, replace the checkpoint, clear the
 * tail — all bounded and amortized. Container metadata stores its content (an
 * exported-updates blob) as its checkpoint row, with no tail.
 */
export const documentHistoryCheckpoints = sqliteTable(
  "document_history_checkpoints",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    snapshot: text("snapshot").notNull(),
    endVersionVector: text("end_version_vector").notNull(),
    revision: text("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.appKind, table.localId] })],
);

/**
 * The local update log: one row per Loro update, serving as both the history
 * tail (restore = checkpoint + tail) and the outbound write queue.
 *
 * Every locally authored update is stored once. While it waits for sync it
 * carries an `updateId` (the id submitted to the server) and the version-vector
 * metadata the submission needs; settlement clears them, leaving the row as
 * ordinary tail history until compaction folds it into a checkpoint.
 *
 * Columns:
 * - `id`: Row id; tail compaction deletes by it.
 * - `appKind`, `localId`: Document scope matching `documents`.
 * - `updateData`: Serialized Loro update payload.
 * - `origin`: "local" (authored on this device) or "remote" (decrypted
 *   pulled update) for tail rows. Restores use it to advance the
 *   outgoing-delta marker across remote rows — their ops are already
 *   server-side — while a local row left behind by a crash stays below the
 *   marker so the next edit re-derives and sends it. "outbox" marks a queued
 *   update with no tail role (container metadata, whose content is its
 *   checkpoint, and full-state re-uploads after a remote reset); restores and
 *   compaction never see it and settlement deletes it.
 * - `createdAt`: Insertion timestamp; with `rowid`, deterministic replay order.
 * - `updateId`: Present exactly while the row is queued for sync; rekeyed
 *   after a lost acknowledgement poisons the submitted id.
 * - `partialStartVersionVector` / `partialEndVersionVector`: Version vectors
 *   around a queued partial update.
 * - `sourceVersionVector`: Present on a queued rotation baseline checkpoint.
 * - `rekeyCount`: Durable bound on rekeys of a queued row.
 *
 * Invariant: compaction never deletes a queued row, so a checkpoint can cover
 * a queued update's operations without removing it from the queue.
 */
export const documentHistoryUpdates = sqliteTable(
  "document_history_updates",
  {
    id: text("id"),
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    updateData: text("update_data").notNull(),
    origin: text("origin").notNull(),
    createdAt: text("created_at").notNull(),
    updateId: text("update_id"),
    partialStartVersionVector: text("partial_start_version_vector"),
    partialEndVersionVector: text("partial_end_version_vector"),
    sourceVersionVector: text("source_version_vector"),
    rekeyCount: integer("rekey_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_history_updates_scope_created_idx").on(
      table.appKind,
      table.localId,
      table.createdAt,
    ),
    uniqueIndex("document_history_updates_update_id_idx")
      .on(table.updateId)
      .where(sql`${table.updateId} IS NOT NULL`),
    // Queued rows only: pending counts and pending loads skip settled history.
    index("document_history_updates_queued_scope_idx")
      .on(table.appKind, table.localId, table.createdAt)
      .where(sql`${table.updateId} IS NOT NULL`),
  ],
);

/**
 * Anti-rollback pin for verified access manifests.
 *
 * Records the highest access-manifest epoch this client has verified for each
 * object, so a later projection that serves an older epoch (rollback) or a
 * conflicting manifest at the same epoch (equivocation) is detected before any
 * key is unwrapped. Updated monotonically after a projection verifies cleanly.
 *
 * Columns:
 * - `objectKind`: Access object kind (`container`, `document`, ...).
 * - `organizationId`: Organization boundary that owns the object.
 * - `objectId`: Stable object id.
 * - `epoch`: Highest verified manifest epoch.
 * - `manifestHash`: Manifest hash pinned at that epoch.
 * - `updatedAt`: Local timestamp for the pin.
 *
 * Indexes:
 * - `(objectKind, organizationId, objectId)` is the primary key and gives one
 *   pin per object.
 */
export const accessManifestCheckpoints = sqliteTable(
  "access_manifest_checkpoints",
  {
    objectKind: text("object_kind").notNull(),
    organizationId: text("organization_id").notNull(),
    objectId: text("object_id").notNull(),
    epoch: integer("epoch").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.objectKind, table.organizationId, table.objectId],
    }),
  ],
);

/**
 * Durable terminal pins for documents whose signed purge proof was verified.
 * These survive remote-state resets so a dishonest API cannot later replay the
 * pre-purge writer projection and resurrect locally deleted content.
 */
export const documentPurgeCheckpoints = sqliteTable(
  "document_purge_checkpoints",
  {
    documentId: text("document_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    documentManifestHash: text("document_manifest_hash").notNull(),
    purgeEventHash: text("purge_event_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

/**
 * Durable pins for user identity bundles.
 *
 * The first validated identity accepted for a user in a configured API trust
 * domain is inserted once. Later observations must match every suite, public
 * key, and fingerprint exactly; the persistence adapter never changes those
 * columns. `firstSeenAt` records when the local trust decision was made and is
 * likewise immutable. `provenance` (`self`, `link`, or `observed`) records how
 * the pin was established; only `self` and `link` admit a user, and it only
 * rises. A table without it is an obsolete local database.
 *
 * Indexes:
 * - `(identityTrustDomain, userId)` is the primary key and scopes a user pin to
 *   the host-configured API authority that supplied it.
 * - `(identityTrustDomain, signingKeyFingerprint)` binds the reverse identity
 *   mapping durably, including across session recreation. There is no
 *   migration for a table that already violates it. Earlier builds pinned a
 *   registration's user id before the server confirmed it, so a device that
 *   ran one may hold two users on one key; deployments are greenfield, and
 *   such a device clears its local data, which recreates this table empty. A
 *   device that used an environment before a reset does the same (see
 *   docs/developer/greenfield-reset.md).
 */
export const trustedUserIdentityPins = sqliteTable(
  "trusted_user_identity_pins",
  {
    identityTrustDomain: text("identity_trust_domain").notNull(),
    userId: text("user_id").notNull(),
    formatVersion: integer("format_version").notNull(),
    signingSuite: text("signing_suite").notNull(),
    signingPublicKey: text("signing_public_key").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
    encapsulationSuite: text("encapsulation_suite").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    encapsulationKeyFingerprint: text(
      "encapsulation_key_fingerprint",
    ).notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    provenance: text("provenance", {
      enum: ["self", "link", "observed"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identityTrustDomain, table.userId],
    }),
    uniqueIndex("trusted_user_identity_pins_domain_signing_fingerprint_idx").on(
      table.identityTrustDomain,
      table.signingKeyFingerprint,
    ),
  ],
);

/**
 * Local many-to-many projection between documents and containers.
 *
 * The document summary row stores one selected `containerId` for primary list
 * placement, while this table keeps the full set of linked containers returned
 * by container/document sync. Removing a container deletes its links and may
 * repair affected document summary rows to point at another remaining link.
 *
 * Columns:
 * - `documentId`: Server document id whose container links are projected.
 * - `containerId`: Linked container id.
 * - `updatedAt`: Local timestamp for the last replacement of the link set.
 *
 * Indexes:
 * - `(documentId, containerId)` is the primary key and prevents duplicate
 *   links for the same document/container pair.
 * - `(containerId, documentId)` serves the container-filtered link scans
 *   (folder item and sidebar windows) as a covering index search.
 */
export const documentContainerProjection = sqliteTable(
  "document_container_projection",
  {
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.containerId] }),
    index("document_container_projection_container_idx").on(
      table.containerId,
      table.documentId,
    ),
  ],
);

/**
 * Queryable document summary and detail projection.
 *
 * The durable Loro state lives in `documents`. This table stores the fields the
 * app needs for document lists, summaries, and fast detail hydration without
 * opening the full Loro snapshot on every read.
 *
 * Columns:
 * - `localId`: Stable local document id. This joins to `documents.localId` for
 *   rows where `documents.appKind = documents`.
 * - `documentId`: Server document id when known.
 * - `containerId`: Selected container for primary document placement, or
 *   `null` if the document is not currently linked to a visible container.
 * - `organizationId`: Last-known owning organization. Stamped from the
 *   container row when the document is detached because its container was
 *   removed locally (e.g. access to a shared org was revoked and the container
 *   tombstoned), so pending writes keep their org attribution after the
 *   `containers` join source disappears. Read as a fallback only — a live
 *   container join always wins.
 * - `documentKind`: Stored document kind. Defaults to `note`.
 * - `title`: Plain projected title. Defaults to the note fallback title.
 * - `updatedAt`: Timestamp used for document list ordering.
 *
 * The projected full text lives in `documentProjectionText`, keyed by the same
 * `localId`. Keeping it out of this row keeps list/window scans narrow: the
 * sidebar and summary queries read titles and placement from rows whose size
 * does not grow with document content.
 *
 * Indexes:
 * - `localId` is the primary key for document projection lookups.
 * - `(containerId) where containerId is not null` serves container-scoped
 *   window/count scans without walking the whole table.
 * - `(organizationId) where containerId is null` serves the orphan-recovery
 *   existence and window scans.
 * - `(documentId) where documentId is not null` serves the linked-placement
 *   join from `documentContainerProjection` and server-id lookups.
 */
export const documentProjection = sqliteTable(
  "document_projection",
  {
    localId: text("local_id"),
    documentId: text("document_id"),
    containerId: text("container_id"),
    organizationId: text("organization_id"),
    documentKind: text("document_kind").notNull().default("note"),
    title: text("title").notNull().default("Untitled note"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.localId] }),
    index("document_projection_container_idx")
      .on(table.containerId)
      .where(sql`${table.containerId} IS NOT NULL`),
    index("document_projection_orphan_organization_idx")
      .on(table.organizationId)
      .where(sql`${table.containerId} IS NULL`),
    index("document_projection_document_idx")
      .on(table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

/**
 * Projected document text, split from `documentProjection` so content size
 * never bloats the rows that list/window queries scan. Loaded only by detail
 * reads (`loadDocument`) and the save-timestamp change check.
 *
 * Columns:
 * - `localId`: Stable local document id, matching `documentProjection.localId`.
 * - `text`: Plain projected text used to rebuild summaries/details.
 */
export const documentProjectionText = sqliteTable(
  "document_projection_text",
  {
    localId: text("local_id"),
    text: text("text").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId] })],
);

/**
 * Per-lane sync state for container data: the server cursor and the local
 * freshness marker share one row per lane.
 *
 * Container sync is split into lanes, such as a parent-container child lane or
 * a container-document membership lane. The cursor lets the next request
 * resume without replaying the entire tree. The freshness marker records the
 * last fully drained check independently of the cursor: empty server
 * responses do not always carry a new watermark, but startup still needs to
 * know that it recently checked the lane before polling again.
 *
 * Columns:
 * - `laneKind`: Sync lane category, such as `container_parent` or
 *   `container_documents`.
 * - `laneId`: Lane identity. Root parent sync uses `root`, child sync uses a
 *   parent-prefixed container id, and document lanes use the container id.
 * - `watermarkUpdatedAt`: Server `updatedAt` value for the stored watermark;
 *   null until a watermark is saved.
 * - `watermarkId`: Server id tie-breaker for the stored watermark; null
 *   exactly when `watermarkUpdatedAt` is.
 * - `updatedAt`: Local timestamp for when the cursor was saved.
 * - `checkedAt`: Local timestamp for the most recent fully drained lane check;
 *   null until one completes.
 *
 * Indexes:
 * - `(laneKind, laneId)` is the primary key and stores one row per lane.
 */
export const containerSyncWatermarks = sqliteTable(
  "container_sync_watermarks",
  {
    laneKind: text("lane_kind").notNull(),
    laneId: text("lane_id").notNull(),
    watermarkUpdatedAt: text("watermark_updated_at"),
    watermarkId: text("watermark_id"),
    updatedAt: text("updated_at"),
    checkedAt: text("checked_at"),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

export const documentTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(documents),
    requiredColumns: [
      "pull_continuation",
      "recovery_generation",
      "recovery_document_id",
      "sync_failure_status",
      "sync_failure_message",
      "sync_failure_attempted_at",
    ],
  },
  defineSqlTableSchema(documentHistoryCheckpoints),
  {
    ...defineSqlTableSchema(documentHistoryUpdates),
    requiredColumns: ["update_id"],
  },
];

export const principalPolicyTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(principalPolicies),
    requiredColumns: ["current_grants_json"],
  },
  {
    ...defineSqlTableSchema(principalPolicyBundleHistory),
    requiredColumns: ["current_grants_json"],
  },
  defineSqlTableSchema(principalPolicyBundleReferences),
  defineSqlTableSchema(principalPolicyOrganizations),
  ...principalHistoryStageTables,
  ...principalHistoryEvidenceTables,
];

export const keyingCheckpointTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationFounders),
  defineSqlTableSchema(accessManifestCheckpoints),
  defineSqlTableSchema(principalGrantRetirements),
  defineSqlTableSchema(documentPurgeCheckpoints),
  defineSqlTableSchema(principalPolicyCheckpoints),
];

export const trustedUserIdentityPinTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(trustedUserIdentityPins),
    requiredColumns: ["provenance"],
  },
];

const securityIncidentTables: ReadonlyArray<SqlTableSchema> = [
  securityIncidentTable,
];

export const containerTables = containerTableSchemas;

export const documentContainerProjectionTables: ReadonlyArray<SqlTableSchema> =
  [
    defineSqlTableSchema(documentContainerProjection),
    {
      ...defineSqlTableSchema(containerDocumentTombstoneHolds),
      requiredColumns: ["hidden"],
    },
    defineSqlTableSchema(pendingDocumentDiscoveries),
    {
      ...defineSqlTableSchema(documentDiscoveryHeads),
      requiredColumns: ["organization_id"],
    },
    defineSqlTableSchema(documentDiscoverySequence),
  ];

export const localIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(localIntents),
];

export const documentPlacementIntentTables: ReadonlyArray<SqlTableSchema> = [
  ...localIntentTables,
  defineSqlTableSchema(documentIntentLinkTargets),
];

export const documentProjectionTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentProjection),
  defineSqlTableSchema(documentProjectionText),
  {
    ...defineSqlTableSchema(documentPendingAttachments),
    requiredColumns: ["content_sha256"],
  },
  {
    ...defineSqlTableSchema(documentAttachmentBlobProjection),
    requiredColumns: ["content_sha256"],
  },
  documentOrphanBlobReclaimTable,
];

export const containerSyncWatermarkTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(containerSyncWatermarks),
    requiredColumns: ["checked_at"],
  },
];

export const clientSqlTables: ReadonlyArray<SqlTableSchema> = [
  ...principalMutationJournalTables,
  ...documentTables,
  ...principalPolicyTables,
  ...keyingCheckpointTables,
  ...verifiedManifestBundleTables,
  ...trustedUserIdentityPinTables,
  ...securityIncidentTables,
  ...containerTables,
  ...documentContainerProjectionTables,
  ...documentPlacementIntentTables,
  ...documentProjectionTables,
  ...containerSyncWatermarkTables,
  ...organizationReadModelTables,
  ...organizationDataUsage.organizationDataUsageTables,
  ...provisioningAttempt.organizationProvisioningAttemptTables,
  ...organizationSyncPause.organizationSyncPauseTables,
];

export const clientSQLiteSchema = {
  principalHistoryNodeReferences,
  principalHistoryRootOwners,
  principalKeyEnvelopeArchive,
  principalMutationJournal,
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
  principalHistoryStages,
  organizationFounders,
  principalGrantRetirements,
  documents,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyOrganizations,
  accessManifestCheckpoints,
  documentPurgeCheckpoints,
  principalPolicyCheckpoints,
  verifiedAccessManifestBundles,
  trustedUserIdentityPins,
  securityIncidents,
  ...containerSQLiteSchema,
  documentContainerProjection,
  localIntents,
  documentIntentLinkTargets,
  documentProjection,
  documentPendingAttachments,
  documentAttachmentBlobProjection,
  documentOrphanBlobReclaims: documentOrphanBlobReclaims,
  containerSyncWatermarks,
  ...organizationReadModelSQLiteSchema,
  ...organizationDataUsage.organizationDataUsageSQLiteSchema,
  ...provisioningAttempt.organizationProvisioningAttemptSQLiteSchema,
  ...organizationSyncPause.organizationSyncPauseSQLiteSchema,
};
