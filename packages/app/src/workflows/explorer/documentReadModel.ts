import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documentSummary";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import {
  containerDocumentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  type ContainerDocumentTombstoneInput,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ExplorerWorkflowSqlRuntime,
  getExplorerWorkflowRuntimeExecSql,
} from "./runtime";

export interface ExplorerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ExplorerContainerDocumentTombstone =
  ContainerDocumentTombstoneInput;

export type ExplorerContainerItemSortKey =
  | "name"
  | "type"
  | "created"
  | "modified";
export type ExplorerContainerItemSortDirection = "asc" | "desc";

export interface ExplorerContainerItemSort {
  direction: ExplorerContainerItemSortDirection;
  key: ExplorerContainerItemSortKey;
}

export type ExplorerContainerItemRow =
  | {
      createdAt: string | null;
      id: string;
      itemKind: "container";
      name: string;
      updatedAt: string | null;
    }
  | {
      containerId: string;
      createdAt: string | null;
      documentId: string | null;
      documentKind: StoredDocumentKind;
      itemKind: "document";
      localId: string;
      name: string;
      updatedAt: string | null;
    };

export interface ExplorerContainerItemWindow {
  rows: ReadonlyArray<ExplorerContainerItemRow>;
  totalCount: number;
}

interface ExplorerDocumentRuntimeTarget {
  documentId: string | null;
  localId: string;
  runtimeContainerId: string;
}

type ExplorerDocumentReadModelRuntime = ExplorerWorkflowSqlRuntime;

export interface ExplorerDocumentPrimeStore {
  requestSync: () => void;
}

export interface ExplorerDocumentPrimeHost<TRuntime> {
  createDocumentRuntime: (containerId: string) => TRuntime;
  primeDocumentStore: (input: {
    documentId: string | null;
    localId: string;
    runtime: TRuntime;
  }) => ExplorerDocumentPrimeStore;
}

export interface ExplorerDocumentReadModel {
  applyContainerDocumentTombstones(
    tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  listContainerItemWindow(input: {
    containerId: string;
    limit: number;
    offset: number;
    sort: ExplorerContainerItemSort;
  }): Promise<ExplorerContainerItemWindow>;
  loadContainerDocumentWatermark(
    containerId: string,
  ): Promise<SyncWatermark | null>;
  listVisibleDocumentSummaries(
    containers: ReadonlyArray<{ id: string }>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  listLinkedContainerIdsByDocumentIds(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ReadonlyArray<string>>>;
  replaceDocumentLinks(
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ): Promise<void>;
  replaceDocumentLinksBatch(
    inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
  ): Promise<void>;
  saveContainerDocumentWatermark(
    containerId: string,
    watermark: SyncWatermark,
  ): Promise<void>;
  upsertDiscoveredDocuments(
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
}

interface ExplorerSharedDocumentSummaries {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface ExplorerContainerSubtreeState {
  container: {
    id: string;
    parentId: string | null;
  };
}

// Keep each IN clause below SQLite's historical 999 bind-parameter limit.
const EXPLORER_SQL_ID_BATCH_SIZE = 500;
const MAX_EXPLORER_CONTAINER_ITEM_WINDOW_LIMIT = 200;

function listExplorerSqlIdBatches(
  values: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> {
  const uniqueValues = Array.from(new Set(values));
  const batches: string[][] = [];

  for (
    let index = 0;
    index < uniqueValues.length;
    index += EXPLORER_SQL_ID_BATCH_SIZE
  ) {
    batches.push(uniqueValues.slice(index, index + EXPLORER_SQL_ID_BATCH_SIZE));
  }

  return batches;
}

function compareExplorerDocumentSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return right.id.localeCompare(left.id);
}

function clampExplorerContainerItemWindowValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function getExplorerContainerItemWindowLimit(limit: number): number {
  return Math.min(
    MAX_EXPLORER_CONTAINER_ITEM_WINDOW_LIMIT,
    clampExplorerContainerItemWindowValue(limit),
  );
}

function getExplorerContainerItemOrderBy(
  sort: ExplorerContainerItemSort,
): string {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";

  if (sort.key === "type") {
    return `type_sort COLLATE NOCASE ${direction}, name COLLATE NOCASE ASC, item_kind_sort ASC, item_id ASC`;
  }

  if (sort.key === "created") {
    return `created_at IS NULL ASC, created_at ${direction}, name COLLATE NOCASE ASC, item_id ASC`;
  }

  if (sort.key === "modified") {
    return `updated_at IS NULL ASC, updated_at ${direction}, name COLLATE NOCASE ASC, item_id ASC`;
  }

  return "item_kind_sort ASC, name COLLATE NOCASE ASC, type_sort COLLATE NOCASE ASC, item_id ASC";
}

function getExplorerContainerItemsBaseSql(): string {
  return `
    WITH container_items AS (
      SELECT
        'container' AS item_kind,
        0 AS item_kind_sort,
        c.id AS item_id,
        NULL AS document_id,
        NULL AS document_kind,
        COALESCE(
          cp.display_name,
          CASE WHEN c.parent_id IS NULL THEN '/' ELSE 'Untitled' END
        ) AS name,
        'folder' AS type_sort,
        COALESCE(c.server_created_at, c.local_created_at) AS created_at,
        COALESCE(c.server_updated_at, c.local_updated_at) AS updated_at
      FROM containers c
      LEFT JOIN container_projection cp ON cp.container_id = c.id
      WHERE c.parent_id = ?

      UNION ALL

      SELECT
        'document' AS item_kind,
        1 AS item_kind_sort,
        d.local_id AS item_id,
        d.document_id AS document_id,
        d.document_kind AS document_kind,
        d.title AS name,
        d.document_kind AS type_sort,
        d.updated_at AS created_at,
        d.updated_at AS updated_at
      FROM document_projection d
      WHERE d.container_id = ?

      UNION ALL

      SELECT
        'document' AS item_kind,
        1 AS item_kind_sort,
        d.local_id AS item_id,
        d.document_id AS document_id,
        d.document_kind AS document_kind,
        d.title AS name,
        d.document_kind AS type_sort,
        d.updated_at AS created_at,
        d.updated_at AS updated_at
      FROM document_container_projection linked
      INNER JOIN document_projection d ON d.document_id = linked.document_id
      WHERE linked.container_id = ?
        AND (
          d.container_id IS NULL
          OR d.container_id != linked.container_id
        )
    )
    SELECT *
    FROM container_items
  `;
}

function parseExplorerContainerItemDocumentKind(
  value: unknown,
): StoredDocumentKind {
  if (
    value === "drivers_license" ||
    value === "credit_card" ||
    value === "note"
  ) {
    return value;
  }

  return "note";
}

function readExplorerContainerItemString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readExplorerContainerItemNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readExplorerContainerItemNumber(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapExplorerContainerItemRow(
  containerId: string,
  row: Record<string, unknown>,
): ExplorerContainerItemRow {
  const itemKind = readExplorerContainerItemString(row, "item_kind");
  if (itemKind === "container") {
    return {
      createdAt: readExplorerContainerItemNullableString(row, "created_at"),
      id: readExplorerContainerItemString(row, "item_id"),
      itemKind: "container",
      name: readExplorerContainerItemString(row, "name"),
      updatedAt: readExplorerContainerItemNullableString(row, "updated_at"),
    };
  }

  return {
    containerId,
    createdAt: readExplorerContainerItemNullableString(row, "created_at"),
    documentId: readExplorerContainerItemNullableString(row, "document_id"),
    documentKind: parseExplorerContainerItemDocumentKind(
      readExplorerContainerItemString(row, "document_kind"),
    ),
    itemKind: "document",
    localId: readExplorerContainerItemString(row, "item_id"),
    name: readExplorerContainerItemString(row, "name"),
    updatedAt: readExplorerContainerItemNullableString(row, "updated_at"),
  };
}

function readExplorerContainerItemCount(row: Record<string, unknown>): number {
  return readExplorerContainerItemNumber(row, "total_count");
}

function addExplorerDocumentSummaries(
  documentSummariesById: Map<string, DocumentSummary>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): void {
  for (const documentSummary of documentSummaries) {
    documentSummariesById.set(documentSummary.id, documentSummary);
  }
}

async function listExplorerDocumentIdsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<string[]> {
  const documentIds = new Set<string>();

  for (const containerIdBatch of listExplorerSqlIdBatches(containerIds)) {
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

async function listExplorerDocumentSummariesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const documentSummariesById = new Map<string, DocumentSummary>();

  for (const containerIdBatch of listExplorerSqlIdBatches(input.containerIds)) {
    addExplorerDocumentSummaries(
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

  for (const documentIdBatch of listExplorerSqlIdBatches(input.documentIds)) {
    addExplorerDocumentSummaries(
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
    compareExplorerDocumentSummaries,
  );
}

async function listVisibleExplorerDocumentSummaries(
  execSql: ExecSql,
  containers: ReadonlyArray<{ id: string }>,
): Promise<ReadonlyArray<DocumentSummary>> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  return listExplorerDocumentSummariesByContainerIdsOrDocumentIds(execSql, {
    containerIds: containers.map((container) => container.id),
    documentIds: [],
  });
}

async function listExplorerContainerItemWindow(
  execSql: ExecSql,
  input: {
    containerId: string;
    limit: number;
    offset: number;
    sort: ExplorerContainerItemSort;
  },
): Promise<ExplorerContainerItemWindow> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const limit = getExplorerContainerItemWindowLimit(input.limit);
  const offset = clampExplorerContainerItemWindowValue(input.offset);
  const bind = [input.containerId, input.containerId, input.containerId];
  const baseSql = getExplorerContainerItemsBaseSql();
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readExplorerContainerItemCount(countRows[0] ?? {});

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getExplorerContainerItemOrderBy(input.sort)} LIMIT ? OFFSET ?`,
    [...bind, limit, offset],
  );

  return {
    rows: rows.map((row) =>
      mapExplorerContainerItemRow(input.containerId, row),
    ),
    totalCount,
  };
}

async function listExplorerDocumentsForContainerSubtree(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ExplorerSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds = await listExplorerDocumentIdsByContainerIds(
    execSql,
    containerIds,
  );
  const documentSummaries =
    await listExplorerDocumentSummariesByContainerIdsOrDocumentIds(execSql, {
      containerIds,
      documentIds: linkedDocumentIds,
    });
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

function listExplorerContainerSubtreeIds(
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>,
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

function resolveExplorerDocumentRuntimeContainerId(params: {
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

async function listExplorerDocumentRuntimeTargetsForContainerSubtree(input: {
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>;
  execSql: ExecSql;
  rootContainerId: string;
}): Promise<ExplorerDocumentRuntimeTarget[]> {
  const { containersById, execSql, rootContainerId } = input;
  const sharedContainerIds = new Set(
    listExplorerContainerSubtreeIds(containersById, rootContainerId),
  );
  if (sharedContainerIds.size === 0) {
    return [];
  }

  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listExplorerDocumentsForContainerSubtree(
      execSql,
      Array.from(sharedContainerIds),
    );

  return documentSummaries.flatMap((documentSummary) => {
    const runtimeContainerId = resolveExplorerDocumentRuntimeContainerId({
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

export function listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof listExplorerDocumentRuntimeTargetsForContainerSubtree>[0],
  "execSql"
> & {
  runtime: ExplorerDocumentReadModelRuntime;
}): ReturnType<typeof listExplorerDocumentRuntimeTargetsForContainerSubtree> {
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);
  return listExplorerDocumentRuntimeTargetsForContainerSubtree({
    ...input,
    execSql,
  });
}

export async function primeExplorerDocumentsForContainerSubtree<
  TRuntime,
>(input: {
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>;
  host: ExplorerDocumentPrimeHost<TRuntime>;
  rootContainerId: string;
  runtime: ExplorerDocumentReadModelRuntime;
}): Promise<number> {
  const targets =
    await listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
      containersById: input.containersById,
      rootContainerId: input.rootContainerId,
      runtime: input.runtime,
    });

  const runtimesByContainerId = new Map<string, TRuntime>();
  for (const target of targets) {
    let runtime = runtimesByContainerId.get(target.runtimeContainerId);
    if (runtime === undefined) {
      runtime = input.host.createDocumentRuntime(target.runtimeContainerId);
      runtimesByContainerId.set(target.runtimeContainerId, runtime);
    }

    input.host
      .primeDocumentStore({
        documentId: target.documentId,
        localId: target.localId,
        runtime,
      })
      .requestSync();
  }

  return targets.length;
}

async function listExplorerLinkedContainerIdsByDocumentIds(
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

  for (const documentIdBatch of listExplorerSqlIdBatches(uniqueDocumentIds)) {
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

function applyExplorerContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return applyContainerDocumentTombstones(execSql, tombstones);
}

function loadExplorerContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(
    execSql,
    containerDocumentsSyncLane(containerId),
  );
}

function replaceExplorerDocumentLinks(
  execSql: ExecSql,
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    execSql,
    documentId,
    linkedContainerIds,
  );
}

function replaceExplorerDocumentLinksBatch(
  execSql: ExecSql,
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    execSql,
    inputs,
  );
}

function saveExplorerContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
  watermark: SyncWatermark,
): Promise<void> {
  return sqlContainerSyncWatermarkPersistence.saveWatermark(
    execSql,
    containerDocumentsSyncLane(containerId),
    watermark,
  );
}

function upsertDiscoveredExplorerDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return upsertDiscoveredDocuments(execSql, inputs);
}

function createExplorerDocumentReadModel(
  execSql: ExecSql,
): ExplorerDocumentReadModel {
  return {
    applyContainerDocumentTombstones(tombstones) {
      return applyExplorerContainerDocumentTombstones(execSql, tombstones);
    },
    listContainerItemWindow(input) {
      return listExplorerContainerItemWindow(execSql, input);
    },
    loadContainerDocumentWatermark(containerId) {
      return loadExplorerContainerDocumentWatermark(execSql, containerId);
    },
    listVisibleDocumentSummaries(containers) {
      return listVisibleExplorerDocumentSummaries(execSql, containers);
    },
    listLinkedContainerIdsByDocumentIds(documentIds) {
      return listExplorerLinkedContainerIdsByDocumentIds(execSql, documentIds);
    },
    replaceDocumentLinks(documentId, linkedContainerIds) {
      return replaceExplorerDocumentLinks(
        execSql,
        documentId,
        linkedContainerIds,
      );
    },
    replaceDocumentLinksBatch(inputs) {
      return replaceExplorerDocumentLinksBatch(execSql, inputs);
    },
    saveContainerDocumentWatermark(containerId, watermark) {
      return saveExplorerContainerDocumentWatermark(
        execSql,
        containerId,
        watermark,
      );
    },
    upsertDiscoveredDocuments(inputs) {
      return upsertDiscoveredExplorerDocuments(execSql, inputs);
    },
  };
}

export function createExplorerDocumentReadModelFromRuntime(
  runtime: ExplorerDocumentReadModelRuntime,
): ExplorerDocumentReadModel {
  return createExplorerDocumentReadModel(
    getExplorerWorkflowRuntimeExecSql(runtime),
  );
}
