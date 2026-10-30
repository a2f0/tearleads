import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../../data/documents/documentSummary";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import {
  RECOVERY_FOLDER_MOVES_SQL,
  RETAINED_CONTAINER_METADATA_SQL,
} from "../../../data/persistence/container-contents/containerRecoveryPersistence";
import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones as applyPersistedContainerDocumentTombstones,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import {
  LOCAL_INTENT_LANES,
  localIntentTables,
} from "../../../data/sqlite/schema";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import {
  listPendingWrites,
  type PendingWriteQueueItem,
  resetPendingWriteRetryState,
} from "../pendingWrites";
import {
  createFolderRecoveryQueries,
  type RecoveryFolder,
} from "../recovery/folderRecovery";
import type { ContainerDocumentObjectSyncState } from "../syncState";
import { hydratedProjectionSql } from "./hydrationSql";
import {
  getOrphanedDocumentQueryBind,
  getOrphanedDocumentWhereSql,
} from "./orphanedDocumentSql";
import {
  listPendingDownloads,
  type PendingDownloadQueueItem,
} from "./pendingDownloads";
import {
  mapContainerContentsDocumentSummaryRow,
  mapContainerContentsDocumentSyncStateRow,
  mapContainerDocumentSidebarRow,
  mapContainerItemRow,
  readContainerContentsContainerItemCount,
} from "./rows";
import {
  clampContainerItemWindowValue,
  getContainerContentsContainerDocumentSidebarOrderBy,
  getContainerContentsContainerItemOrderBy,
  getContainerContentsContainerItemsBaseSql,
  getContainerContentsDocumentPendingStateCtes,
  getContainerContentsDocumentRowsBaseSql,
  getContainerDocumentSidebarWindowLimit,
  getContainerItemWindowLimit,
  getOrphanedDocumentExistsSql,
  getOrphanedDocumentItemsBaseSql,
  getOrphanedDocumentRowsBaseSql,
  listContainerContentsSqlIdBatches,
} from "./sql";
import type {
  ContainerDocumentLinkInput,
  ContainerDocumentQueriesRuntime,
  ContainerDocumentSidebarWindow,
  ContainerDocumentTombstone,
  ContainerItemSort,
  ContainerItemWindow,
} from "./types";

export type {
  ContainerDocumentLinkInput,
  ContainerDocumentSidebarRow,
  ContainerDocumentTombstone,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "./types";

interface ListContainerItemWindowInput {
  /** Null selects the virtual orphaned-documents recovery collection. */
  containerId: string | null;
  currentOrganizationId?: string | null | undefined;
  limit: number;
  offset: number;
  sort: ContainerItemSort;
  visibleForeignSystemContainerNames?: ReadonlyArray<string> | undefined;
  visibleSystemSlots?: ReadonlyArray<ContainerSystemSlot> | undefined;
}

export interface ContainerDocumentQueries {
  listRecoveryFolderMoveIds(input: {
    currentOrganizationId: string | null;
  }): Promise<string[]>;
  listRecoveryFolders(input: {
    currentOrganizationId: string | null;
  }): Promise<RecoveryFolder[]>;
  discardRecoveryFolder(
    input: Pick<RecoveryFolder, "containerId" | "organizationId" | "revision">,
  ): Promise<boolean>;
  applyContainerDocumentTombstones(
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  hasOrphanedDocuments(input: {
    currentOrganizationId: string | null;
  }): Promise<boolean>;
  listContainerDocumentSidebarWindow(input: {
    /** Null selects the virtual orphaned-documents recovery collection. */
    containerId: string | null;
    currentOrganizationId?: string | null | undefined;
    limit: number;
    offset: number;
  }): Promise<ContainerDocumentSidebarWindow>;
  listContainerItemWindow(
    input: ListContainerItemWindowInput,
  ): Promise<ContainerItemWindow>;
  loadDocumentSyncState(
    localId: string,
  ): Promise<ContainerDocumentObjectSyncState | null>;
  loadDocumentSummary(
    localId: string,
    options?: { requireHydrated?: boolean },
  ): Promise<DocumentSummary | null>;
  loadOrphanedDocumentSummary(input: {
    requireHydrated?: boolean;
    currentOrganizationId: string | null;
    localId: string;
  }): Promise<DocumentSummary | null>;
  loadContainerDocumentWatermark(
    containerId: string,
  ): Promise<SyncWatermark | null>;
  listLinkedContainerIdsByDocumentIds(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ReadonlyArray<string>>>;
  listPendingDownloads(): Promise<ReadonlyArray<PendingDownloadQueueItem>>;
  listPendingWrites(): Promise<ReadonlyArray<PendingWriteQueueItem>>;
  retryPendingWriteItem(input: {
    localId: string;
    namespace: string | null;
    objectKind: PendingWriteQueueItem["objectKind"];
  }): Promise<void>;
  replaceDocumentLinksBatch(
    inputs: ReadonlyArray<ContainerDocumentLinkInput>,
  ): Promise<void>;
  saveContainerDocumentWatermark(
    containerId: string,
    watermark: SyncWatermark,
  ): Promise<void>;
  upsertDiscoveredDocuments(
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
}

async function listContainerItemWindow(
  execSql: ExecSql,
  input: ListContainerItemWindowInput,
): Promise<ContainerItemWindow> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, localIntentTables);

  const limit = getContainerItemWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const visibleSystemSlots = Array.from(
    new Set(input.visibleSystemSlots ?? []),
  );
  const currentOrganizationId = input.currentOrganizationId || null;
  const visibleForeignSystemContainerNames = currentOrganizationId
    ? Array.from(new Set(input.visibleForeignSystemContainerNames ?? []))
    : [];
  const orphaned = input.containerId === null;
  const bind = orphaned
    ? getOrphanedDocumentQueryBind(input.currentOrganizationId)
    : [
        input.containerId,
        ...visibleSystemSlots,
        ...(visibleForeignSystemContainerNames.length > 0
          ? [currentOrganizationId, ...visibleForeignSystemContainerNames]
          : []),
        input.containerId,
        input.containerId,
      ];
  const baseSql = orphaned
    ? getOrphanedDocumentItemsBaseSql()
    : getContainerContentsContainerItemsBaseSql(
        visibleSystemSlots.length,
        visibleForeignSystemContainerNames.length,
      );
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readContainerContentsContainerItemCount(
    countRows[0] ?? {},
  );

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getContainerContentsContainerItemOrderBy(input.sort)} LIMIT ? OFFSET ?`,
    [...bind, limit, offset],
  );

  return {
    rows: rows.map((row) => mapContainerItemRow(input.containerId, row)),
    totalCount,
  };
}

async function hasOrphanedDocuments(
  execSql: ExecSql,
  currentOrganizationId: string | null,
): Promise<boolean> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  // One statement for all three probes; the folder probes need an
  // organization, as their standalone readers do.
  const folderProbes = currentOrganizationId
    ? `OR EXISTS(${RETAINED_CONTAINER_METADATA_SQL}) OR EXISTS(${RECOVERY_FOLDER_MOVES_SQL})`
    : "";
  if (currentOrganizationId)
    await sqlContainerContentsPersistence.ensureSchema(execSql);
  const rows = await execSql(
    `SELECT (EXISTS(${getOrphanedDocumentExistsSql()}) ${folderProbes}) AS found`,
    [
      ...getOrphanedDocumentQueryBind(currentOrganizationId),
      ...(currentOrganizationId
        ? [
            currentOrganizationId,
            LOCAL_INTENT_LANES.containerMove,
            currentOrganizationId,
          ]
        : []),
    ],
  );
  return Number(Object.values(rows[0] ?? {})[0] ?? 0) !== 0;
}

async function listContainerDocumentSidebarWindow(
  execSql: ExecSql,
  input: {
    containerId: string | null;
    currentOrganizationId?: string | null | undefined;
    limit: number;
    offset: number;
  },
): Promise<ContainerDocumentSidebarWindow> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const limit = getContainerDocumentSidebarWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const orphaned = input.containerId === null;
  const bind = orphaned
    ? getOrphanedDocumentQueryBind(input.currentOrganizationId)
    : [input.containerId, input.containerId];
  const baseSql = orphaned
    ? getOrphanedDocumentRowsBaseSql()
    : getContainerContentsDocumentRowsBaseSql();
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readContainerContentsContainerItemCount(
    countRows[0] ?? {},
  );

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getContainerContentsContainerDocumentSidebarOrderBy()} LIMIT ? OFFSET ?`,
    [...bind, limit, offset],
  );

  return {
    rows: rows.map(mapContainerDocumentSidebarRow),
    totalCount,
  };
}

async function queryContainerContentsDocumentSummary(
  execSql: ExecSql,
  localId: string,
  scope: { bind: ReadonlyArray<string | null>; whereSql: string },
): Promise<DocumentSummary | null> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const rows = await execSql(
    `
      SELECT
        d.local_id AS local_id,
        d.document_id AS document_id,
        d.container_id AS container_id,
        d.document_kind AS document_kind,
        d.title AS title,
        d.updated_at AS updated_at,
        stored.access_state_hash AS access_state_hash,
        stored.effective_access_level AS effective_access_level
      FROM document_projection d
      LEFT JOIN documents stored
        ON stored.app_kind = 'documents'
        AND stored.local_id = d.local_id
      WHERE d.local_id = ?
      ${scope.whereSql}
      LIMIT 1
    `,
    [localId, ...scope.bind],
  );

  return mapContainerContentsDocumentSummaryRow(rows[0] ?? {});
}

function loadContainerContentsDocumentSummary(
  execSql: ExecSql,
  localId: string,
  requireHydrated: boolean,
): Promise<DocumentSummary | null> {
  return queryContainerContentsDocumentSummary(execSql, localId, {
    bind: [],
    whereSql: requireHydrated
      ? `AND ${hydratedProjectionSql("d.local_id", "documents")}`
      : "",
  });
}

function loadContainerContentsOrphanedDocumentSummary(
  execSql: ExecSql,
  localId: string,
  currentOrganizationId: string | null,
  requireHydrated: boolean,
): Promise<DocumentSummary | null> {
  return queryContainerContentsDocumentSummary(execSql, localId, {
    bind: getOrphanedDocumentQueryBind(currentOrganizationId),
    whereSql: `${requireHydrated ? `AND ${hydratedProjectionSql("d.local_id", "documents")}` : ""} AND ${getOrphanedDocumentWhereSql(
      {
        documentIdSql: "d.document_id",
        projectionAlias: "d",
      },
    )}`,
  });
}

async function loadContainerContentsDocumentSyncState(
  execSql: ExecSql,
  localId: string,
): Promise<ContainerDocumentObjectSyncState | null> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const rows = await execSql(
    `
      WITH ${getContainerContentsDocumentPendingStateCtes()}
      SELECT
        d.document_id AS document_id,
        COALESCE(document_updates.pending_update_count, 0) AS pending_update_count,
        COALESCE(document_attachments.pending_attachment_count, 0) AS pending_attachment_count,
        COALESCE(document_attachments.pending_attachment_bytes, 0) AS pending_attachment_bytes,
        NULL AS sync_last_error
      FROM document_projection d
      LEFT JOIN document_pending_update_counts document_updates
        ON document_updates.local_id = d.local_id
      LEFT JOIN document_pending_attachment_counts document_attachments
        ON document_attachments.local_id = d.local_id
      WHERE d.local_id = ?
      LIMIT 1
    `,
    [localId],
  );
  const [row] = rows;
  if (!row) {
    return null;
  }

  return mapContainerContentsDocumentSyncStateRow(row);
}

async function listContainerContentsLinkedContainerIdsByDocumentIds(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  const uniqueDocumentIds = Array.from(new Set(documentIds));
  if (uniqueDocumentIds.length === 0) {
    return new Map();
  }

  const linkedContainerIdsByDocumentId = new Map<string, string[]>();
  for (const documentId of uniqueDocumentIds) {
    linkedContainerIdsByDocumentId.set(documentId, []);
  }

  for (const documentIdBatch of listContainerContentsSqlIdBatches(
    uniqueDocumentIds,
  )) {
    const batchLinkedContainerIdsByDocumentId =
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
        execSql,
        documentIdBatch,
      );
    for (const [
      documentId,
      linkedContainerIds,
    ] of batchLinkedContainerIdsByDocumentId.entries()) {
      linkedContainerIdsByDocumentId.set(
        documentId,
        Array.from(linkedContainerIds),
      );
    }
  }

  return linkedContainerIdsByDocumentId;
}

export function createContainerDocumentQueriesFromRuntime(
  runtime: ContainerDocumentQueriesRuntime,
): ContainerDocumentQueries {
  const execSql = runtime.infra.execSql;
  return {
    ...createFolderRecoveryQueries(execSql),
    applyContainerDocumentTombstones(tombstones) {
      return applyPersistedContainerDocumentTombstones(execSql, tombstones);
    },
    hasOrphanedDocuments({ currentOrganizationId }) {
      return hasOrphanedDocuments(execSql, currentOrganizationId);
    },
    listContainerDocumentSidebarWindow(input) {
      return listContainerDocumentSidebarWindow(execSql, input);
    },
    listContainerItemWindow(input) {
      return listContainerItemWindow(execSql, input);
    },
    loadDocumentSyncState(localId) {
      return loadContainerContentsDocumentSyncState(execSql, localId);
    },
    loadDocumentSummary(localId, options) {
      return loadContainerContentsDocumentSummary(
        execSql,
        localId,
        options?.requireHydrated ?? false,
      );
    },
    loadOrphanedDocumentSummary({
      currentOrganizationId,
      localId,
      requireHydrated = false,
    }) {
      return loadContainerContentsOrphanedDocumentSummary(
        execSql,
        localId,
        currentOrganizationId,
        requireHydrated,
      );
    },
    loadContainerDocumentWatermark(containerId) {
      return sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerContentsSyncLane(containerId),
      );
    },
    listLinkedContainerIdsByDocumentIds(documentIds) {
      return listContainerContentsLinkedContainerIdsByDocumentIds(
        execSql,
        documentIds,
      );
    },
    listPendingDownloads() {
      return listPendingDownloads(execSql);
    },
    listPendingWrites() {
      return listPendingWrites(execSql);
    },
    retryPendingWriteItem(input) {
      return resetPendingWriteRetryState(execSql, input);
    },
    replaceDocumentLinksBatch(inputs) {
      return sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        execSql,
        inputs,
      );
    },
    async saveContainerDocumentWatermark(containerId, watermark) {
      await sqlContainerSyncWatermarkPersistence.saveWatermark(
        execSql,
        containerContentsSyncLane(containerId),
        watermark,
      );
    },
    upsertDiscoveredDocuments(inputs) {
      return upsertDiscoveredDocuments(execSql, inputs);
    },
  };
}
