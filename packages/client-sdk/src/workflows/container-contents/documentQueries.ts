import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documentSummary";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones as applyPersistedContainerDocumentTombstones,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import { containerCreateIntentTables } from "../../data/sqlite/schema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import {
  compareContainerContentsDocumentSummaries,
  mapContainerContentsDocumentSummaryRow,
  mapContainerContentsDocumentSyncStateRow,
  mapContainerDocumentSidebarRow,
  mapContainerItemRow,
  readContainerContentsContainerItemCount,
} from "./documentQueries/rows";
import {
  clampContainerItemWindowValue,
  getContainerContentsContainerDocumentSidebarOrderBy,
  getContainerContentsContainerItemOrderBy,
  getContainerContentsContainerItemsBaseSql,
  getContainerContentsDocumentPendingStateCtes,
  getContainerContentsDocumentRowsBaseSql,
  getContainerDocumentSidebarWindowLimit,
  getContainerItemWindowLimit,
  listContainerContentsSqlIdBatches,
} from "./documentQueries/sql";
import type {
  ContainerContentsContainerSubtreeState,
  ContainerContentsDocumentRuntimeTarget,
  ContainerContentsSharedDocumentSummaries,
  ContainerDocumentLinkInput,
  ContainerDocumentQueriesRuntime,
  ContainerDocumentSidebarWindow as ContainerDocumentSidebarWindowContract,
  ContainerDocumentTombstone,
  ContainerItemSort,
  ContainerItemWindow as ContainerItemWindowContract,
} from "./documentQueries/types";
import {
  listPendingWrites,
  type PendingWriteQueueItem,
  resetPendingWriteRetryState,
} from "./pendingWrites";
import type { ContainerDocumentObjectSyncState } from "./syncState";

export type {
  ContainerDocumentLinkInput,
  ContainerDocumentSidebarRow,
  ContainerDocumentTombstone,
  ContainerItemRow,
  ContainerItemSort,
  ContainerItemSortDirection,
  ContainerItemSortKey,
} from "./documentQueries/types";

export type ContainerDocumentSidebarWindow =
  ContainerDocumentSidebarWindowContract;
export type ContainerItemWindow = ContainerItemWindowContract;

interface ListContainerItemWindowInput {
  containerId: string;
  currentOrganizationId?: string | null | undefined;
  limit: number;
  offset: number;
  sort: ContainerItemSort;
  visibleForeignSystemContainerNames?: ReadonlyArray<string> | undefined;
  visibleSystemSlots?: ReadonlyArray<ContainerSystemSlot> | undefined;
}

export interface ContainerDocumentQueries {
  applyContainerDocumentTombstones(
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  listContainerDocumentSidebarWindow(input: {
    containerId: string;
    limit: number;
    offset: number;
  }): Promise<ContainerDocumentSidebarWindow>;
  listContainerItemWindow(
    input: ListContainerItemWindowInput,
  ): Promise<ContainerItemWindow>;
  loadDocumentSyncState(
    localId: string,
  ): Promise<ContainerDocumentObjectSyncState | null>;
  loadDocumentSummary(localId: string): Promise<DocumentSummary | null>;
  loadContainerDocumentWatermark(
    containerId: string,
  ): Promise<SyncWatermark | null>;
  listLinkedContainerIdsByDocumentIds(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ReadonlyArray<string>>>;
  listPendingWrites(): Promise<ReadonlyArray<PendingWriteQueueItem>>;
  retryPendingWriteItem(input: {
    localId: string;
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

function addContainerContentsDocumentSummaries(
  documentSummariesById: Map<string, DocumentSummary>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): void {
  for (const documentSummary of documentSummaries) {
    documentSummariesById.set(documentSummary.id, documentSummary);
  }
}

async function listContainerContentsDocumentIdsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<string[]> {
  const documentIds = new Set<string>();

  for (const containerIdBatch of listContainerContentsSqlIdBatches(
    containerIds,
  )) {
    const batchDocumentIds =
      await sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
        execSql,
        containerIdBatch,
      );
    for (const documentId of batchDocumentIds) {
      documentIds.add(documentId);
    }
  }

  return Array.from(documentIds).sort();
}

async function listContainerContentsDocumentSummariesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const documentSummariesById = new Map<string, DocumentSummary>();

  for (const containerIdBatch of listContainerContentsSqlIdBatches(
    input.containerIds,
  )) {
    addContainerContentsDocumentSummaries(
      documentSummariesById,
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: containerIdBatch,
          documentIds: [],
        },
      ),
    );
  }

  for (const documentIdBatch of listContainerContentsSqlIdBatches(
    input.documentIds,
  )) {
    addContainerContentsDocumentSummaries(
      documentSummariesById,
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: [],
          documentIds: documentIdBatch,
        },
      ),
    );
  }

  return Array.from(documentSummariesById.values()).sort(
    compareContainerContentsDocumentSummaries,
  );
}

async function listContainerItemWindow(
  execSql: ExecSql,
  input: ListContainerItemWindowInput,
): Promise<ContainerItemWindow> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, containerCreateIntentTables);

  const limit = getContainerItemWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const visibleSystemSlots = Array.from(
    new Set(input.visibleSystemSlots ?? []),
  );
  const currentOrganizationId = input.currentOrganizationId || null;
  const visibleForeignSystemContainerNames = currentOrganizationId
    ? Array.from(new Set(input.visibleForeignSystemContainerNames ?? []))
    : [];
  const bind = [
    input.containerId,
    ...visibleSystemSlots,
    ...(visibleForeignSystemContainerNames.length > 0
      ? [currentOrganizationId, ...visibleForeignSystemContainerNames]
      : []),
    input.containerId,
    input.containerId,
  ];
  const baseSql = getContainerContentsContainerItemsBaseSql(
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

async function listContainerDocumentSidebarWindow(
  execSql: ExecSql,
  input: {
    containerId: string;
    limit: number;
    offset: number;
  },
): Promise<ContainerDocumentSidebarWindow> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const limit = getContainerDocumentSidebarWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const bind = [input.containerId, input.containerId];
  const baseSql = getContainerContentsDocumentRowsBaseSql();
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

async function loadContainerContentsDocumentSummary(
  execSql: ExecSql,
  localId: string,
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
      LIMIT 1
    `,
    [localId],
  );

  return mapContainerContentsDocumentSummaryRow(rows[0] ?? {});
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

async function listContainerContentsDocumentsForContainerSubtree(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ContainerContentsSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds =
    await listContainerContentsDocumentIdsByContainerIds(execSql, containerIds);
  const documentSummaries =
    await listContainerContentsDocumentSummariesByContainerIdsOrDocumentIds(
      execSql,
      {
        containerIds,
        documentIds: linkedDocumentIds,
      },
    );
  const documentIds = Array.from(
    new Set(
      documentSummaries.flatMap((documentSummary) =>
        documentSummary.documentId ? [documentSummary.documentId] : [],
      ),
    ),
  );
  const linkedContainerIdsByDocumentId =
    await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
      execSql,
      documentIds,
    );

  return { documentSummaries, linkedContainerIdsByDocumentId };
}

function listContainerContentsContainerSubtreeIds(
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>,
  rootContainerId: string,
): string[] {
  const childrenByParentId = new Map<string, string[]>();
  for (const containerState of containersById.values()) {
    const parentId = containerState.container.parentId;
    if (parentId === null) {
      continue;
    }

    const children = childrenByParentId.get(parentId);
    if (children) {
      children.push(containerState.container.id);
    } else {
      childrenByParentId.set(parentId, [containerState.container.id]);
    }
  }

  const subtreeIds: string[] = [];
  const stack = [rootContainerId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const containerId = stack.pop();
    if (containerId === undefined || visited.has(containerId)) {
      continue;
    }
    visited.add(containerId);

    if (containersById.has(containerId)) {
      subtreeIds.push(containerId);
    }

    const children = childrenByParentId.get(containerId);
    if (children) {
      stack.push(...children);
    }
  }

  return subtreeIds;
}

function resolveContainerContentsDocumentRuntimeContainerId(params: {
  documentSummary: Pick<DocumentSummary, "containerId" | "documentId">;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  sharedContainerIds: ReadonlySet<string>;
}): string | null {
  const {
    documentSummary,
    linkedContainerIdsByDocumentId,
    sharedContainerIds,
  } = params;
  if (
    documentSummary.containerId &&
    sharedContainerIds.has(documentSummary.containerId)
  ) {
    return documentSummary.containerId;
  }

  if (!documentSummary.documentId) {
    return null;
  }

  return (
    linkedContainerIdsByDocumentId
      .get(documentSummary.documentId)
      ?.find((containerId) => sharedContainerIds.has(containerId)) ?? null
  );
}

async function listDocumentRuntimeTargetsForContainerSubtree(input: {
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>;
  execSql: ExecSql;
  rootContainerId: string;
}): Promise<ContainerContentsDocumentRuntimeTarget[]> {
  const { containersById, execSql, rootContainerId } = input;
  const sharedContainerIds = new Set(
    listContainerContentsContainerSubtreeIds(containersById, rootContainerId),
  );
  if (sharedContainerIds.size === 0) {
    return [];
  }

  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listContainerContentsDocumentsForContainerSubtree(
      execSql,
      Array.from(sharedContainerIds),
    );

  return documentSummaries.flatMap((documentSummary) => {
    const runtimeContainerId =
      resolveContainerContentsDocumentRuntimeContainerId({
        documentSummary,
        linkedContainerIdsByDocumentId,
        sharedContainerIds,
      });
    if (!runtimeContainerId) {
      return [];
    }

    return [
      {
        documentId: documentSummary.documentId,
        localId: documentSummary.id,
        runtimeContainerId,
      },
    ];
  });
}

export function listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof listDocumentRuntimeTargetsForContainerSubtree>[0],
  "execSql"
> & {
  runtime: ContainerDocumentQueriesRuntime;
}): ReturnType<typeof listDocumentRuntimeTargetsForContainerSubtree> {
  return listDocumentRuntimeTargetsForContainerSubtree({
    ...input,
    execSql: runtime.infra.execSql,
  });
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

function applyStoredContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstone>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return applyPersistedContainerDocumentTombstones(execSql, tombstones);
}

function loadContainerContentsContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(
    execSql,
    containerContentsSyncLane(containerId),
  );
}

function replaceDocumentLinksBatch(
  execSql: ExecSql,
  inputs: ReadonlyArray<ContainerDocumentLinkInput>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    execSql,
    inputs,
  );
}

function saveContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
  watermark: SyncWatermark,
): Promise<void> {
  return sqlContainerSyncWatermarkPersistence.saveWatermark(
    execSql,
    containerContentsSyncLane(containerId),
    watermark,
  );
}

function upsertDiscoveredContainerContentsDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return upsertDiscoveredDocuments(execSql, inputs);
}

function createContainerDocumentQueries(
  execSql: ExecSql,
): ContainerDocumentQueries {
  return {
    applyContainerDocumentTombstones(tombstones) {
      return applyStoredContainerDocumentTombstones(execSql, tombstones);
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
    loadDocumentSummary(localId) {
      return loadContainerContentsDocumentSummary(execSql, localId);
    },
    loadContainerDocumentWatermark(containerId) {
      return loadContainerContentsContainerDocumentWatermark(
        execSql,
        containerId,
      );
    },
    listLinkedContainerIdsByDocumentIds(documentIds) {
      return listContainerContentsLinkedContainerIdsByDocumentIds(
        execSql,
        documentIds,
      );
    },
    listPendingWrites() {
      return listPendingWrites(execSql);
    },
    retryPendingWriteItem(input) {
      return resetPendingWriteRetryState(execSql, input);
    },
    replaceDocumentLinksBatch(inputs) {
      return replaceDocumentLinksBatch(execSql, inputs);
    },
    saveContainerDocumentWatermark(containerId, watermark) {
      return saveContainerDocumentWatermark(execSql, containerId, watermark);
    },
    upsertDiscoveredDocuments(inputs) {
      return upsertDiscoveredContainerContentsDocuments(execSql, inputs);
    },
  };
}

export function createContainerDocumentQueriesFromRuntime(
  runtime: ContainerDocumentQueriesRuntime,
): ContainerDocumentQueries {
  return createContainerDocumentQueries(runtime.infra.execSql);
}
