import { base64ToBytes } from "@tearleads/encoding";
import { getImportBlobMetadata } from "@tearleads/loro";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  type DocumentRecord,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  ensureDocumentProjectionTables,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  mapSelectedDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  rekeyDocumentPendingUpdate,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerCreateIntentTables,
  containerMoveIntents,
  containerMoveIntentTables,
  containerProjection,
  containerSyncWatermarks,
  containers,
  documentContainerProjection,
  documentContainerProjectionTables,
  documentHistoryCheckpoints,
  documentMoveIntentTables,
  documentPendingUpdates,
  documentProjection,
  documentProjectionTables,
  documents,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  type ContainerRecord,
  deleteContainerRowsInTransaction,
  ensureContainerTables,
  loadContainers as loadContainerRecords,
  saveContainerRows,
} from "../containers/containerPersistence";
import {
  containerContentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
  deleteContainerWatermarksInTransaction,
  sqlContainerSyncWatermarkPersistence,
} from "../containers/containerSyncWatermarkPersistence";
import { reassignContainerDocumentsInTransaction } from "./containerDocumentReassignment";
import {
  CONTAINER_METADATA_APP_KIND,
  clearDormantContainerMetadataInTransaction,
  deleteContainerMetadataDocumentRowsInTransaction,
  retainDormantContainerMetadataInTransaction,
} from "./dormantContainerMetadata";
import {
  completeDormantMetadataSweepRequest,
  type DormantMetadataSweepPersistence,
  listDormantMetadataSweepCandidates,
  listDormantMetadataSweepRequests,
  purgeDormantContainerMetadataCandidates,
} from "./dormantMetadataSweep";

export { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

const CONTAINER_CREATE_INTENT_TYPE = "container.create";
const CONTAINER_MOVE_INTENT_TYPE = "container.move";

export type ContainerCreateIntentSyncStatus = "pending" | "synced";
export type ContainerMoveIntentSyncStatus = "pending" | "blocked";

export interface ContainerCreateIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  intentType: typeof CONTAINER_CREATE_INTENT_TYPE;
  syncStatus: ContainerCreateIntentSyncStatus;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerMoveIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  previousParentContainerId: string | null;
  intentType: typeof CONTAINER_MOVE_INTENT_TYPE;
  syncStatus: ContainerMoveIntentSyncStatus;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerCreateIntentInput {
  id?: string;
  parentContainerId: string;
}

export interface ContainerMoveIntentInput {
  id?: string;
  parentContainerId: string;
  previousParentContainerId?: string | null | undefined;
}

export interface LocalRootDescendantReparentInput {
  containerId: string;
  parentContainerId: string | null;
  updateCreateIntent?: boolean | undefined;
}

/**
 * A container's metadata document record plus its durable content: the full
 * Loro updates export of the metadata document, stored in the shared
 * history-checkpoint table under the container-metadata app kind. Metadata
 * documents are tiny registries, so the whole update log is the checkpoint.
 */
export interface ContainerMetadataRecord extends DocumentRecord {
  metadataUpdates: string;
}

export interface StoredContainerState {
  container: ContainerRecord;
  record: ContainerMetadataRecord | null;
}

export interface ContainerContentsPersistence
  extends DormantMetadataSweepPersistence {
  containerExists: (execSql: ExecSql, containerId: string) => Promise<boolean>;
  deleteContainer: (
    execSql: ExecSql,
    containerId: string,
    options?: { updatedAt?: string },
  ) => Promise<void>;
  deleteContainers: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
    options?: {
      /**
       * Containers whose own container-metadata document (record, queued
       * updates, failure rows) must survive the cascade — the access_revoked
       * branch of docs/sync-edge-cases.md row 4. The metadata re-attaches by
       * container id when access restoration rehydrates the container.
       */
      retainMetadataForContainerIds?: ReadonlyArray<string>;
      updatedAt?: string;
    },
  ) => Promise<void>;
  deletePendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<void>;
  listPendingCreateIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerCreateIntentRecord[]>;
  listPendingMoveIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerMoveIntentRecord[]>;
  // Every move intent that has not yet synced, regardless of syncStatus —
  // a blocked move (destination parent not synced yet) is still unsynced.
  // Synced moves are deleted, so any surviving row qualifies. Use this where a
  // 'pending'-only view would miss blocked intents (e.g. hydration must not
  // revert a blocked local move's parent to the server value).
  listUnsyncedMoveIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerMoveIntentRecord[]>;
  listContainerIdsWithPendingUpdates: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
  ) => Promise<string[]>;
  listPendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<PendingUpdateRecord[]>;
  rekeyPendingUpdate: (execSql: ExecSql, id: string) => Promise<string | null>;
  recordCreateIntentError: (
    execSql: ExecSql,
    containerId: string,
    message: string,
  ) => Promise<void>;
  recordMoveIntentError: (
    execSql: ExecSql,
    input: {
      blocked?: boolean | undefined;
      containerId: string;
      message: string;
    },
  ) => Promise<void>;
  reassignContainerDocuments: (
    execSql: ExecSql,
    input: {
      fromContainerId: string;
      toContainerId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalRootContainer: (
    execSql: ExecSql,
    input: {
      descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
      localRootContainerId: string;
      remoteOrganizationId: string;
      remoteRootContainerId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalSystemContainer: (
    execSql: ExecSql,
    input: {
      localContainerId: string;
      remoteContainerId: string;
      remoteOrganizationId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredContainerState>>;
  /**
   * Load a container-metadata record by container id alone, without
   * requiring a containers row — the dormant shape row 4's access_revoked
   * branch leaves behind, re-attached on rehydration.
   */
  loadContainerMetadataRecord: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<ContainerMetadataRecord | null>;
  /**
   * Destroy a dormant container-metadata scope whose remote metadata document
   * was replaced while access was revoked: its record, queued updates, and
   * failure rows all belong to a dead update stream and must never target the
   * replacement document.
   */
  purgeDormantContainerMetadata: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  saveContainer: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: ContainerMetadataRecord | null,
    options?: {
      createIntent?: ContainerCreateIntentInput;
      localUpdatedAt?: string;
      moveIntent?: ContainerMoveIntentInput | undefined;
      serverTimestamps?:
        | {
            createdAt?: string | null;
            updatedAt?: string | null;
          }
        | undefined;
      updatedAt?: string;
    },
  ) => Promise<ContainerRecord>;
  saveContainerAndDeletePendingUpdates: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: ContainerMetadataRecord,
    pendingUpdateIds: readonly string[],
  ) => Promise<ContainerRecord>;
  markCreateIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      // The intent row's updatedAt snapshotted when the pass listed it. The
      // mark is a no-op if the row changed since (a user re-queued the intent
      // across the create network await), so the re-queued intent stays pending.
      expectedUpdatedAt: string;
      remoteContainerId: string;
      remoteMetadataAccessStateHash: string;
      remoteMetadataDocumentId: string;
    },
  ) => Promise<void>;
  markMoveIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      // See markCreateIntentSynced: guards the delete against a move re-queued
      // during the network round-trip so the new destination is not discarded.
      expectedUpdatedAt: string;
    },
  ) => Promise<void>;
}

function getContainerMetadataScope(containerId: string) {
  return {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
}

function getLatestTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }
  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
}

function parseCreateIntentSyncStatus(
  value: unknown,
): ContainerCreateIntentSyncStatus {
  return value === "synced" ? "synced" : "pending";
}

function parseMoveIntentSyncStatus(
  value: unknown,
): ContainerMoveIntentSyncStatus {
  return value === "blocked" ? "blocked" : "pending";
}

interface SelectedContainerCreateIntentRecord {
  id: string | null;
  containerId: string;
  parentContainerId: string;
  syncStatus: string;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SelectedContainerMoveIntentRecord {
  id: string | null;
  containerId: string;
  parentContainerId: string;
  previousParentContainerId: string | null;
  syncStatus: string;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapContainerCreateIntentRecord(
  row: SelectedContainerCreateIntentRecord,
): ContainerCreateIntentRecord {
  return {
    id: String(row.id ?? ""),
    containerId: row.containerId,
    parentContainerId: row.parentContainerId,
    intentType: CONTAINER_CREATE_INTENT_TYPE,
    syncStatus: parseCreateIntentSyncStatus(row.syncStatus),
    remoteContainerId: row.remoteContainerId,
    remoteMetadataDocumentId: row.remoteMetadataDocumentId,
    remoteMetadataAccessStateHash: row.remoteMetadataAccessStateHash,
    lastError: row.lastError,
    lastAttemptedAt: row.lastAttemptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapContainerMoveIntentRecord(
  row: SelectedContainerMoveIntentRecord,
): ContainerMoveIntentRecord {
  return {
    id: String(row.id ?? ""),
    containerId: row.containerId,
    parentContainerId: row.parentContainerId,
    previousParentContainerId: row.previousParentContainerId,
    intentType: CONTAINER_MOVE_INTENT_TYPE,
    syncStatus: parseMoveIntentSyncStatus(row.syncStatus),
    lastError: row.lastError,
    lastAttemptedAt: row.lastAttemptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// The metadata document's content frontier, derived from its full updates
// export. Empty or undecodable blobs read as "never hydrated".
function deriveMetadataEndVersion(metadataUpdates: string): string {
  if (metadataUpdates.length === 0) {
    return "";
  }

  try {
    return getImportBlobMetadata(base64ToBytes(metadataUpdates))
      .partialEndVersionVector;
  } catch {
    return "";
  }
}

async function saveContainerMetadataRecord(input: {
  containerId: string;
  record: ContainerMetadataRecord;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}) {
  const { containerId, record, tx, updatedAt } = input;
  const snapshotEndVersion = deriveMetadataEndVersion(record.metadataUpdates);
  const nextRow = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
    documentId: record.documentId,
    snapshotEndVersion,
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    updatedAt,
  };

  await tx
    .insert(documents)
    .values(nextRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: nextRow,
    })
    .run();

  // The metadata document's content lives in the shared history-checkpoint
  // table, like every other document kind. The whole updates export IS the
  // checkpoint: metadata documents are tiny registries, so no tail/compaction
  // machinery is needed, and the row replaces atomically with the record.
  const checkpointRow = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
    snapshot: record.metadataUpdates,
    endVersionVector: snapshotEndVersion,
    revision: updatedAt,
    updatedAt,
  };
  await tx
    .insert(documentHistoryCheckpoints)
    .values(checkpointRow)
    .onConflictDoUpdate({
      target: [
        documentHistoryCheckpoints.appKind,
        documentHistoryCheckpoints.localId,
      ],
      set: checkpointRow,
    })
    .run();
}

async function saveContainerContentsContainerRows(input: {
  container: ContainerRecord;
  createIntent?: ContainerCreateIntentInput | undefined;
  moveIntent?: ContainerMoveIntentInput | undefined;
  record: ContainerMetadataRecord | null;
  tx: ClientSQLiteTransaction;
  localUpdatedAt: string;
  serverTimestamps?:
    | {
        createdAt?: string | null;
        updatedAt?: string | null;
      }
    | undefined;
}): Promise<ContainerRecord> {
  const {
    container,
    createIntent,
    moveIntent,
    localUpdatedAt,
    record,
    serverTimestamps,
    tx,
  } = input;
  const nextContainer = {
    ...container,
    ...(serverTimestamps
      ? {
          serverCreatedAt:
            serverTimestamps.createdAt ?? container.serverCreatedAt ?? null,
          serverUpdatedAt:
            serverTimestamps.updatedAt ?? container.serverUpdatedAt ?? null,
        }
      : {}),
  };

  const savedContainer = await saveContainerRows({
    record: nextContainer,
    tx,
    localUpdatedAt,
  });
  await clearDormantContainerMetadataInTransaction(tx, [container.id]);

  if (record) {
    await saveContainerMetadataRecord({
      containerId: container.id,
      record: {
        ...record,
        id: container.id,
      },
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  if (createIntent) {
    await saveContainerCreateIntent({
      containerId: container.id,
      createIntent,
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  if (moveIntent) {
    await saveContainerMoveIntent({
      containerId: container.id,
      moveIntent,
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  return savedContainer;
}

async function saveContainerCreateIntent(input: {
  tx: ClientSQLiteTransaction;
  containerId: string;
  createIntent: ContainerCreateIntentInput;
  updatedAt: string;
}) {
  const { containerId, createIntent, tx, updatedAt } = input;
  await tx
    .insert(containerCreateIntents)
    .values({
      id: createIntent.id ?? crypto.randomUUID(),
      containerId,
      parentContainerId: createIntent.parentContainerId,
      intentType: CONTAINER_CREATE_INTENT_TYPE,
      syncStatus: "pending",
      remoteContainerId: null,
      remoteMetadataDocumentId: null,
      remoteMetadataAccessStateHash: null,
      lastError: null,
      lastAttemptedAt: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: containerCreateIntents.containerId,
      set: {
        parentContainerId: createIntent.parentContainerId,
        intentType: CONTAINER_CREATE_INTENT_TYPE,
        syncStatus: "pending",
        remoteContainerId: null,
        remoteMetadataDocumentId: null,
        remoteMetadataAccessStateHash: null,
        lastError: null,
        lastAttemptedAt: null,
        updatedAt,
      },
    })
    .run();
}

async function saveContainerMoveIntent(input: {
  tx: ClientSQLiteTransaction;
  containerId: string;
  moveIntent: ContainerMoveIntentInput;
  updatedAt: string;
}) {
  const { containerId, moveIntent, tx, updatedAt } = input;
  await tx
    .insert(containerMoveIntents)
    .values({
      id: moveIntent.id ?? crypto.randomUUID(),
      containerId,
      parentContainerId: moveIntent.parentContainerId,
      previousParentContainerId: moveIntent.previousParentContainerId ?? null,
      intentType: CONTAINER_MOVE_INTENT_TYPE,
      syncStatus: "pending",
      lastError: null,
      lastAttemptedAt: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: containerMoveIntents.containerId,
      set: {
        parentContainerId: moveIntent.parentContainerId,
        previousParentContainerId: sql`coalesce(${containerMoveIntents.previousParentContainerId}, ${moveIntent.previousParentContainerId ?? null})`,
        intentType: CONTAINER_MOVE_INTENT_TYPE,
        syncStatus: "pending",
        lastError: null,
        updatedAt,
      },
    })
    .run();
}

async function hasPendingContainerMetadataUpdates(input: {
  tx: ClientSQLiteTransaction;
  containerId: string;
}): Promise<boolean> {
  const rows = await input.tx
    .select({ id: documentPendingUpdates.id })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentPendingUpdates.localId, input.containerId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// The containers being removed still exist when repair runs (deletion follows
// it). Capture their org attribution so a detached document's pending writes
// keep a resolvable organization id after the join source is gone — e.g. when
// access to a shared org is revoked mid-sync.
async function loadOrganizationIdsForContainers(
  tx: ClientSQLiteTransaction,
  containerIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(inArray(containers.id, containerIds));
  const organizationIdByContainerId = new Map<string, string>();
  for (const container of rows) {
    if (container.id && container.organizationId) {
      organizationIdByContainerId.set(container.id, container.organizationId);
    }
  }
  return organizationIdByContainerId;
}

// A document unlinked from a removed container may keep other live links; its
// projection then re-homes to the first remaining link (deterministic order)
// instead of dropping to null.
async function loadFirstRemainingContainerIdByDocumentId(
  tx: ClientSQLiteTransaction,
  documentIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const firstRemainingContainerIdByDocumentId = new Map<string, string>();
  if (documentIds.length === 0) {
    return firstRemainingContainerIdByDocumentId;
  }
  const remainingLinks = await tx
    .select({
      containerId: documentContainerProjection.containerId,
      documentId: documentContainerProjection.documentId,
    })
    .from(documentContainerProjection)
    .where(inArray(documentContainerProjection.documentId, documentIds))
    .orderBy(
      asc(documentContainerProjection.documentId),
      asc(documentContainerProjection.containerId),
    );
  for (const link of remainingLinks) {
    if (!firstRemainingContainerIdByDocumentId.has(link.documentId)) {
      firstRemainingContainerIdByDocumentId.set(
        link.documentId,
        link.containerId,
      );
    }
  }
  return firstRemainingContainerIdByDocumentId;
}

async function repairDocumentsForRemovedContainersInTransaction(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { tx, updatedAt } = input;
  const containerIds = Array.from(new Set(input.containerIds));
  if (containerIds.length === 0) {
    return;
  }

  {
    const selectedRows = await tx
      .select({
        containerId: documentProjection.containerId,
        documentId: documentProjection.documentId,
        localId: documentProjection.localId,
        updatedAt: documentProjection.updatedAt,
      })
      .from(documentProjection)
      .where(inArray(documentProjection.containerId, containerIds));

    const organizationIdByContainerId = await loadOrganizationIdsForContainers(
      tx,
      containerIds,
    );

    await tx
      .delete(documentContainerProjection)
      .where(inArray(documentContainerProjection.containerId, containerIds))
      .run();

    const documentIds = Array.from(
      new Set(
        selectedRows.flatMap((row) => (row.documentId ? [row.documentId] : [])),
      ),
    );
    const firstRemainingContainerIdByDocumentId =
      await loadFirstRemainingContainerIdByDocumentId(tx, documentIds);

    for (const row of selectedRows) {
      if (!row.localId) {
        continue;
      }

      const removedOrganizationId = row.containerId
        ? organizationIdByContainerId.get(row.containerId)
        : undefined;
      await tx
        .update(documentProjection)
        .set({
          containerId: row.documentId
            ? (firstRemainingContainerIdByDocumentId.get(row.documentId) ??
              null)
            : null,
          ...(removedOrganizationId
            ? { organizationId: removedOrganizationId }
            : {}),
          updatedAt: getLatestTimestamp(row.updatedAt, updatedAt),
        })
        .where(eq(documentProjection.localId, row.localId))
        .run();
    }
  }
}

async function updateReparentedDescendantContainers(input: {
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  remoteOrganizationId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { descendantReparents, remoteOrganizationId, tx, updatedAt } = input;
  const descendantIds = Array.from(
    new Set(descendantReparents.map((reparent) => reparent.containerId)),
  );
  if (descendantIds.length === 0) {
    return;
  }

  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      localUpdatedAt: updatedAt,
    })
    .where(inArray(containers.id, descendantIds))
    .run();
  await tx
    .update(containerProjection)
    .set({ updatedAt })
    .where(inArray(containerProjection.containerId, descendantIds))
    .run();

  for (const reparent of descendantReparents) {
    await tx
      .update(containers)
      .set({ parentId: reparent.parentContainerId })
      .where(eq(containers.id, reparent.containerId))
      .run();

    if (reparent.updateCreateIntent && reparent.parentContainerId) {
      await saveContainerCreateIntent({
        containerId: reparent.containerId,
        createIntent: { parentContainerId: reparent.parentContainerId },
        tx,
        updatedAt,
      });
    }

    if (reparent.parentContainerId) {
      await tx
        .update(containerMoveIntents)
        .set({
          parentContainerId: reparent.parentContainerId,
          syncStatus: "pending",
          updatedAt,
        })
        .where(eq(containerMoveIntents.containerId, reparent.containerId))
        .run();
    }
  }
}

async function reparentLocalContainerChildren(input: {
  fromContainerId: string;
  remoteOrganizationId: string;
  toContainerId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const {
    fromContainerId,
    remoteOrganizationId,
    toContainerId,
    tx,
    updatedAt,
  } = input;
  const childRows = await tx
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.parentId, fromContainerId));
  const childContainerIds = childRows.flatMap((row) =>
    row.id ? [row.id] : [],
  );

  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      parentId: toContainerId,
      localUpdatedAt: updatedAt,
    })
    .where(eq(containers.parentId, fromContainerId))
    .run();
  if (childContainerIds.length > 0) {
    await tx
      .update(containerProjection)
      .set({ updatedAt })
      .where(inArray(containerProjection.containerId, childContainerIds))
      .run();
  }
  await tx
    .update(containerCreateIntents)
    .set({
      parentContainerId: toContainerId,
      updatedAt,
    })
    .where(eq(containerCreateIntents.parentContainerId, fromContainerId))
    .run();
  await tx
    .update(containerMoveIntents)
    .set({
      parentContainerId: toContainerId,
      syncStatus: "pending",
      updatedAt,
    })
    .where(eq(containerMoveIntents.parentContainerId, fromContainerId))
    .run();
}

async function deleteLocalContainerRows(input: {
  containerId: string;
  tx: ClientSQLiteTransaction;
}): Promise<void> {
  const { containerId, tx } = input;
  const parentLane = containerSyncWatermarkLaneKey(
    containerParentSyncLane(containerId),
  );
  const documentsLane = containerSyncWatermarkLaneKey(
    containerContentsSyncLane(containerId),
  );

  await tx
    .delete(containerCreateIntents)
    .where(eq(containerCreateIntents.containerId, containerId))
    .run();
  await tx
    .delete(containerMoveIntents)
    .where(eq(containerMoveIntents.containerId, containerId))
    .run();
  await tx
    .delete(containerProjection)
    .where(eq(containerProjection.containerId, containerId))
    .run();
  await tx.delete(containers).where(eq(containers.id, containerId)).run();
  await deleteContainerMetadataDocumentRowsInTransaction(tx, [containerId]);
  await tx
    .delete(containerSyncWatermarks)
    .where(
      or(
        and(
          eq(containerSyncWatermarks.laneKind, parentLane.laneKind),
          eq(containerSyncWatermarks.laneId, parentLane.laneId),
        ),
        and(
          eq(containerSyncWatermarks.laneKind, documentsLane.laneKind),
          eq(containerSyncWatermarks.laneId, documentsLane.laneId),
        ),
      ),
    )
    .run();
}

/**
 * ONE joined statement, so the record's key/access fields and the checkpoint
 * content it pairs with come from a single consistent read — two separate
 * queries could interleave with a concurrent metadata save (record +
 * checkpoint written in one transaction) and pair stale keying state with
 * newer content.
 */
async function selectContainerMetadataRecord(
  execSql: ExecSql,
  containerId: string,
): Promise<ContainerMetadataRecord | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      snapshotEndVersion: documents.snapshotEndVersion,
      accessEpoch: documents.accessEpoch,
      accessStateHash: documents.accessStateHash,
      effectiveAccessLevel: documents.effectiveAccessLevel,
      lastCommitLsn: documents.lastCommitLsn,
      documentManifestBundle: documents.documentManifestBundle,
      contentKeyBundle: documents.contentKeyBundle,
      documentKekTargets: documents.documentKekTargets,
      pendingBaseVersion: documents.pendingBaseVersion,
      metadataUpdates: documentHistoryCheckpoints.snapshot,
    })
    .from(documents)
    .leftJoin(
      documentHistoryCheckpoints,
      and(
        eq(documentHistoryCheckpoints.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentHistoryCheckpoints.localId, documents.localId),
      ),
    )
    .where(
      and(
        eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documents.localId, containerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const { metadataUpdates, ...recordRow } = row;
  return {
    ...mapSelectedDocumentRecord(recordRow),
    metadataUpdates: metadataUpdates ?? "",
  };
}

export const sqlContainerContentsPersistence: ContainerContentsPersistence = {
  completeDormantMetadataSweepRequest,
  async containerExists(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1);
    return rows.length > 0;
  },
  async deleteContainer(execSql, containerId, options) {
    await sqlContainerContentsPersistence.deleteContainers(
      execSql,
      [containerId],
      options,
    );
  },
  async deleteContainers(execSql, containerIds, options) {
    const uniqueContainerIds = Array.from(new Set(containerIds));
    if (uniqueContainerIds.length === 0) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = options?.updatedAt ?? new Date().toISOString();
      // Table creation (idempotent DDL) stays outside the cascade
      // transaction; every mutation below runs inside ONE transaction so a
      // crash leaves the cascade fully unapplied — the tombstone re-applies
      // it when the lane refetches — instead of stranding metadata rows
      // that re-delivered tombstones would then skip.
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      await ensureDocumentProjectionTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      const uniqueContainerIdSet = new Set(uniqueContainerIds);
      const retainMetadataIds = new Set(
        (options?.retainMetadataForContainerIds ?? []).filter((containerId) =>
          uniqueContainerIdSet.has(containerId),
        ),
      );
      const metadataDeleteIds = uniqueContainerIds.filter(
        (containerId) => !retainMetadataIds.has(containerId),
      );
      const retainedAt = new Date().toISOString();
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const retainedContainers =
            retainMetadataIds.size === 0
              ? []
              : await tx
                  .select({
                    containerId: containers.id,
                    organizationId: containers.organizationId,
                  })
                  .from(containers)
                  .where(inArray(containers.id, Array.from(retainMetadataIds)));
          await retainDormantContainerMetadataInTransaction(
            tx,
            retainedContainers.flatMap((container) =>
              container.containerId
                ? [
                    {
                      containerId: container.containerId,
                      organizationId: container.organizationId,
                      retainedAt,
                    },
                  ]
                : [],
            ),
          );
          await repairDocumentsForRemovedContainersInTransaction({
            containerIds: uniqueContainerIds,
            tx,
            updatedAt,
          });
          await tx
            .delete(containerCreateIntents)
            .where(
              inArray(containerCreateIntents.containerId, uniqueContainerIds),
            )
            .run();
          await tx
            .delete(containerMoveIntents)
            .where(
              inArray(containerMoveIntents.containerId, uniqueContainerIds),
            )
            .run();
          await deleteContainerRowsInTransaction(tx, uniqueContainerIds);
          await deleteContainerMetadataDocumentRowsInTransaction(
            tx,
            metadataDeleteIds,
          );
          await deleteContainerWatermarksInTransaction(tx, uniqueContainerIds);
        },
      );
    });
  },
  async deletePendingUpdates(execSql, containerId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
    });
  },
  async ensureSchema(execSql) {
    // Once ensured on this connection, skip the outer mutation lock entirely:
    // ensureSchema runs on every query path, and re-acquiring the lock just to
    // no-op would queue reads behind unrelated writes.
    await runOncePerConnection(execSql, "ensure:container-contents", () =>
      runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await ensureContainerTables(lockedExecSql);
        await ensureDocumentTables(lockedExecSql);
        await ensureSqlTables(lockedExecSql, containerCreateIntentTables);
        await ensureSqlTables(lockedExecSql, containerMoveIntentTables);
        await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
        await ensureDocumentProjectionTables(lockedExecSql);
        await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      }),
    );
  },
  async enqueuePendingUpdate(execSql, input) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getContainerMetadataScope(input.containerId),
        input,
      );
    });
  },
  async listPendingUpdates(execSql, containerId) {
    return listDocumentPendingUpdates(
      execSql,
      getContainerMetadataScope(containerId),
    );
  },
  listDormantMetadataSweepRequests,
  async rekeyPendingUpdate(execSql, id) {
    return rekeyDocumentPendingUpdate(execSql, id);
  },
  async listPendingCreateIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        id: containerCreateIntents.id,
        containerId: containerCreateIntents.containerId,
        parentContainerId: containerCreateIntents.parentContainerId,
        syncStatus: containerCreateIntents.syncStatus,
        remoteContainerId: containerCreateIntents.remoteContainerId,
        remoteMetadataDocumentId:
          containerCreateIntents.remoteMetadataDocumentId,
        remoteMetadataAccessStateHash:
          containerCreateIntents.remoteMetadataAccessStateHash,
        lastError: containerCreateIntents.lastError,
        lastAttemptedAt: containerCreateIntents.lastAttemptedAt,
        createdAt: containerCreateIntents.createdAt,
        updatedAt: containerCreateIntents.updatedAt,
      })
      .from(containerCreateIntents)
      .where(
        and(
          eq(containerCreateIntents.syncStatus, "pending"),
          eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(containerCreateIntents.createdAt));

    return rows.map((row) => mapContainerCreateIntentRecord(row));
  },
  async listPendingMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        id: containerMoveIntents.id,
        containerId: containerMoveIntents.containerId,
        parentContainerId: containerMoveIntents.parentContainerId,
        previousParentContainerId:
          containerMoveIntents.previousParentContainerId,
        syncStatus: containerMoveIntents.syncStatus,
        lastError: containerMoveIntents.lastError,
        lastAttemptedAt: containerMoveIntents.lastAttemptedAt,
        createdAt: containerMoveIntents.createdAt,
        updatedAt: containerMoveIntents.updatedAt,
      })
      .from(containerMoveIntents)
      // Blocked intents replay too: "blocked" names the reason the last
      // attempt could not proceed, not a terminal verdict — the missing
      // container can appear via hydration, after which the move completes.
      .where(
        and(
          inArray(containerMoveIntents.syncStatus, ["pending", "blocked"]),
          eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(containerMoveIntents.createdAt));

    return rows.map((row) => mapContainerMoveIntentRecord(row));
  },

  async listUnsyncedMoveIntents(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // No syncStatus filter: synced moves are deleted (see markMoveIntentSynced),
    // so every surviving row is unsynced, including 'blocked' ones, which
    // hydration must still not revert.
    const rows = await db
      .select({
        id: containerMoveIntents.id,
        containerId: containerMoveIntents.containerId,
        parentContainerId: containerMoveIntents.parentContainerId,
        previousParentContainerId:
          containerMoveIntents.previousParentContainerId,
        syncStatus: containerMoveIntents.syncStatus,
        lastError: containerMoveIntents.lastError,
        lastAttemptedAt: containerMoveIntents.lastAttemptedAt,
        createdAt: containerMoveIntents.createdAt,
        updatedAt: containerMoveIntents.updatedAt,
      })
      .from(containerMoveIntents)
      .where(eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE))
      .orderBy(asc(containerMoveIntents.createdAt));

    return rows.map((row) => mapContainerMoveIntentRecord(row));
  },
  async listContainerIdsWithPendingUpdates(execSql, containerIds) {
    const uniqueContainerIds = Array.from(new Set(containerIds));
    if (uniqueContainerIds.length === 0) {
      return [];
    }

    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .selectDistinct({ containerId: documentPendingUpdates.localId })
      .from(documentPendingUpdates)
      .where(
        and(
          eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
          inArray(documentPendingUpdates.localId, uniqueContainerIds),
        ),
      )
      .orderBy(asc(documentPendingUpdates.localId));

    return rows.map((row) => row.containerId);
  },
  async recordCreateIntentError(execSql, containerId, message) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const updatedAt = new Date().toISOString();
      await db
        .update(containerCreateIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: message,
          updatedAt,
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, containerId),
            eq(containerCreateIntents.syncStatus, "pending"),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
  async recordMoveIntentError(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const updatedAt = new Date().toISOString();
      await db
        .update(containerMoveIntents)
        .set({
          lastAttemptedAt: updatedAt,
          lastError: input.message,
          syncStatus: input.blocked ? "blocked" : "pending",
          updatedAt,
        })
        .where(
          and(
            eq(containerMoveIntents.containerId, input.containerId),
            // Blocked rows stay updatable so a retried intent records its
            // fresh outcome and a transient failure unblocks it.
            inArray(containerMoveIntents.syncStatus, ["pending", "blocked"]),
            eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
  async reassignContainerDocuments(execSql, input) {
    if (input.fromContainerId === input.toContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.fromContainerId,
            toContainerId: input.toContainerId,
            tx,
            updatedAt,
          });
        },
      );
    });
  },
  async reconcileLocalRootContainer(execSql, input) {
    if (input.localRootContainerId === input.remoteRootContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...containerCreateIntentTables,
        ...containerMoveIntentTables,
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await updateReparentedDescendantContainers({
            descendantReparents: input.descendantReparents,
            remoteOrganizationId: input.remoteOrganizationId,
            tx,
            updatedAt,
          });
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.localRootContainerId,
            toContainerId: input.remoteRootContainerId,
            tx,
            updatedAt,
          });
          await deleteLocalContainerRows({
            containerId: input.localRootContainerId,
            tx,
          });
        },
      );
    });
  },
  async reconcileLocalSystemContainer(execSql, input) {
    if (input.localContainerId === input.remoteContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...containerCreateIntentTables,
        ...containerMoveIntentTables,
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await reparentLocalContainerChildren({
            fromContainerId: input.localContainerId,
            remoteOrganizationId: input.remoteOrganizationId,
            toContainerId: input.remoteContainerId,
            tx,
            updatedAt,
          });
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.localContainerId,
            toContainerId: input.remoteContainerId,
            tx,
            updatedAt,
          });
          await deleteLocalContainerRows({
            containerId: input.localContainerId,
            tx,
          });
        },
      );
    });
  },
  async loadContainerMetadataRecord(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    return selectContainerMetadataRecord(execSql, containerId);
  },
  async purgeDormantContainerMetadata(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      // ONE transaction: a crash that deleted the documents row but kept the
      // pending updates would hide the dormant record from the next
      // hydration's mismatch check, letting dead-stream updates resurface
      // against the replacement metadata document.
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await deleteContainerMetadataDocumentRowsInTransaction(tx, [
            containerId,
          ]);
        },
      );
    });
  },
  listDormantMetadataSweepCandidates,
  purgeDormantContainerMetadataCandidates,
  async loadContainers(execSql) {
    const containers = await loadContainerRecords(execSql);
    const storedContainers = await Promise.all(
      containers.map(async (container) => ({
        container,
        record: await selectContainerMetadataRecord(execSql, container.id),
      })),
    );

    return storedContainers;
  },
  async saveContainer(execSql, container, record, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const localUpdatedAt =
        options?.localUpdatedAt ??
        options?.updatedAt ??
        new Date().toISOString();
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) =>
          saveContainerContentsContainerRows({
            container,
            createIntent: options?.createIntent,
            moveIntent: options?.moveIntent,
            record,
            serverTimestamps: options?.serverTimestamps,
            tx,
            localUpdatedAt,
          }),
      );
    });
  },
  async saveContainerAndDeletePendingUpdates(
    execSql,
    container,
    record,
    pendingUpdateIds,
  ) {
    const uniquePendingUpdateIds = [...new Set(pendingUpdateIds)];

    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const localUpdatedAt = new Date().toISOString();
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          if (uniquePendingUpdateIds.length > 0) {
            await tx
              .delete(documentPendingUpdates)
              .where(
                and(
                  eq(
                    documentPendingUpdates.appKind,
                    CONTAINER_METADATA_APP_KIND,
                  ),
                  eq(documentPendingUpdates.localId, container.id),
                  inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
                ),
              )
              .run();
          }

          const hasRemainingPendingUpdates =
            await hasPendingContainerMetadataUpdates({
              containerId: container.id,
              tx,
            });
          const containerToSave = hasRemainingPendingUpdates
            ? container
            : {
                ...container,
                serverUpdatedAt: getLatestTimestamp(
                  container.serverUpdatedAt,
                  localUpdatedAt,
                ),
              };

          return saveContainerContentsContainerRows({
            container: containerToSave,
            record,
            tx,
            localUpdatedAt,
          });
        },
      );
    });
  },
  async markCreateIntentSynced(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .update(containerCreateIntents)
        .set({
          syncStatus: "synced",
          remoteContainerId: input.remoteContainerId,
          remoteMetadataDocumentId: input.remoteMetadataDocumentId,
          remoteMetadataAccessStateHash: input.remoteMetadataAccessStateHash,
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, input.containerId),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
            // Only mark synced if the row is still the one this pass consumed. A
            // user re-queue across the create network await rewrites the row with
            // a fresh updatedAt; that intent must stay pending for the next pass.
            eq(containerCreateIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    });
  },
  async markMoveIntentSynced(execSql, input) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(containerMoveIntents)
        .where(
          and(
            eq(containerMoveIntents.containerId, input.containerId),
            eq(containerMoveIntents.intentType, CONTAINER_MOVE_INTENT_TYPE),
            // Only clear the intent this pass consumed. If the user re-queued the
            // move during the network round-trip, the row's updatedAt advanced
            // and this delete no-ops, preserving the new destination for sync.
            eq(containerMoveIntents.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .run();
    });
  },
};
