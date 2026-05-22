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
  applyContainerDocumentTombstones as applyPersistedContainerDocumentTombstones,
  type ContainerDocumentTombstoneInput,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import { containerCreateIntentTables } from "../../data/sqlite/schema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import {
  type ContainerDocumentsWorkflowSqlRuntime,
  getContainerDocumentsWorkflowRuntimeExecSql,
} from "./runtime";
import {
  type ContainerDocumentObjectSyncState,
  createContainerDocumentObjectSyncState,
} from "./syncState";

export interface ContainerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ContainerDocumentTombstone = ContainerDocumentTombstoneInput;

export type ContainerItemSortKey = "name" | "type" | "created" | "modified";
export type ContainerItemSortDirection = "asc" | "desc";

export interface ContainerItemSort {
  direction: ContainerItemSortDirection;
  key: ContainerItemSortKey;
}

export type ContainerItemRow =
  | {
      createdAt: string | null;
      id: string;
      itemKind: "container";
      name: string;
      syncState: ContainerDocumentObjectSyncState;
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
      syncState: ContainerDocumentObjectSyncState;
      updatedAt: string | null;
    };

export interface ContainerItemWindow {
  rows: ReadonlyArray<ContainerItemRow>;
  totalCount: number;
}

export interface ContainerDocumentSidebarRow {
  containerId: string;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  localId: string;
  syncState: ContainerDocumentObjectSyncState;
  title: string;
  updatedAt: string | null;
}

export interface ContainerDocumentSidebarWindow {
  rows: ReadonlyArray<ContainerDocumentSidebarRow>;
  totalCount: number;
}

interface ContainerDocumentsDocumentRuntimeTarget {
  documentId: string | null;
  localId: string;
  runtimeContainerId: string;
}

type ContainerDocumentReadModelRuntime = ContainerDocumentsWorkflowSqlRuntime;

export interface ContainerDocumentPrimeStore {
  requestSync: () => void;
}

export interface ContainerDocumentPrimeHost<TRuntime> {
  createDocumentRuntime: (containerId: string) => TRuntime;
  primeDocumentStore: (input: {
    documentId: string | null;
    localId: string;
    runtime: TRuntime;
  }) => ContainerDocumentPrimeStore;
}

export interface ContainerDocumentReadModel {
  applyContainerDocumentTombstones(
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  listContainerDocumentSidebarWindow(input: {
    containerId: string;
    limit: number;
    offset: number;
  }): Promise<ContainerDocumentSidebarWindow>;
  listContainerItemWindow(input: {
    containerId: string;
    limit: number;
    offset: number;
    sort: ContainerItemSort;
  }): Promise<ContainerItemWindow>;
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
  replaceDocumentLinks(
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ): Promise<void>;
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

interface ContainerDocumentsSharedDocumentSummaries {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface ContainerDocumentsContainerSubtreeState {
  container: {
    id: string;
    parentId: string | null;
  };
}

// Keep each IN clause below SQLite's historical 999 bind-parameter limit.
const CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE = 500;
const MAX_CONTAINER_ITEM_WINDOW_LIMIT = 200;
const MAX_CONTAINER_DOCUMENT_SIDEBAR_WINDOW_LIMIT = 200;

function listContainerDocumentsSqlIdBatches(
  values: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> {
  const uniqueValues = Array.from(new Set(values));
  const batches: string[][] = [];

  for (
    let index = 0;
    index < uniqueValues.length;
    index += CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE
  ) {
    batches.push(
      uniqueValues.slice(index, index + CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE),
    );
  }

  return batches;
}

function compareContainerDocumentsDocumentSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return right.id.localeCompare(left.id);
}

function clampContainerItemWindowValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function getContainerItemWindowLimit(limit: number): number {
  return Math.min(
    MAX_CONTAINER_ITEM_WINDOW_LIMIT,
    clampContainerItemWindowValue(limit),
  );
}

function getContainerDocumentSidebarWindowLimit(limit: number): number {
  return Math.min(
    MAX_CONTAINER_DOCUMENT_SIDEBAR_WINDOW_LIMIT,
    clampContainerItemWindowValue(limit),
  );
}

function getContainerDocumentsContainerItemOrderBy(
  sort: ContainerItemSort,
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

function getContainerDocumentsDocumentPendingStateCtes(): string {
  return `
    document_pending_update_counts AS (
      SELECT
        local_id,
        COUNT(*) AS pending_update_count
      FROM document_pending_updates
      WHERE app_kind = 'documents'
      GROUP BY local_id
    ),
    document_pending_attachment_counts AS (
      SELECT
        local_id,
        COUNT(*) AS pending_attachment_count,
        COALESCE(SUM(byte_length), 0) AS pending_attachment_bytes
      FROM document_pending_attachments
      GROUP BY local_id
    )
  `;
}

function getContainerDocumentsContainerItemsBaseSql(): string {
  return `
    WITH ${getContainerDocumentsDocumentPendingStateCtes()},
    container_metadata_pending_update_counts AS (
      SELECT
        local_id,
        COUNT(*) AS pending_update_count
      FROM document_pending_updates
      WHERE app_kind = 'container-metadata'
      GROUP BY local_id
    ),
    pending_container_create_intents AS (
      SELECT
        container_id,
        MAX(last_error) AS last_error
      FROM container_create_intents
      WHERE intent_type = 'container.create'
        AND sync_status = 'pending'
      GROUP BY container_id
    ),
    container_items AS (
      SELECT
        'container' AS item_kind,
        0 AS item_kind_sort,
        c.id AS item_id,
        NULL AS document_id,
        NULL AS document_kind,
        c.metadata_document_id AS metadata_document_id,
        c.local_updated_at AS local_updated_at,
        c.server_created_at AS server_created_at,
        c.server_updated_at AS server_updated_at,
        COALESCE(container_updates.pending_update_count, 0) AS pending_update_count,
        0 AS pending_attachment_count,
        0 AS pending_attachment_bytes,
        create_intent.last_error AS sync_last_error,
        COALESCE(
          cp.display_name,
          CASE WHEN c.parent_id IS NULL THEN '/' ELSE 'Untitled' END
        ) AS name,
        'folder' AS type_sort,
        COALESCE(c.server_created_at, c.local_created_at) AS created_at,
        COALESCE(c.server_updated_at, c.local_updated_at) AS updated_at
      FROM containers c
      LEFT JOIN container_projection cp ON cp.container_id = c.id
      LEFT JOIN container_metadata_pending_update_counts container_updates
        ON container_updates.local_id = c.id
      LEFT JOIN pending_container_create_intents create_intent
        ON create_intent.container_id = c.id
      WHERE c.parent_id = ?

      UNION ALL

      SELECT
        'document' AS item_kind,
        1 AS item_kind_sort,
        d.local_id AS item_id,
        d.document_id AS document_id,
        d.document_kind AS document_kind,
        NULL AS metadata_document_id,
        NULL AS local_updated_at,
        NULL AS server_created_at,
        NULL AS server_updated_at,
        COALESCE(document_updates.pending_update_count, 0) AS pending_update_count,
        COALESCE(document_attachments.pending_attachment_count, 0) AS pending_attachment_count,
        COALESCE(document_attachments.pending_attachment_bytes, 0) AS pending_attachment_bytes,
        NULL AS sync_last_error,
        d.title AS name,
        d.document_kind AS type_sort,
        d.updated_at AS created_at,
        d.updated_at AS updated_at
      FROM document_projection d
      LEFT JOIN document_pending_update_counts document_updates
        ON document_updates.local_id = d.local_id
      LEFT JOIN document_pending_attachment_counts document_attachments
        ON document_attachments.local_id = d.local_id
      WHERE d.container_id = ?

      UNION ALL

      SELECT
        'document' AS item_kind,
        1 AS item_kind_sort,
        d.local_id AS item_id,
        d.document_id AS document_id,
        d.document_kind AS document_kind,
        NULL AS metadata_document_id,
        NULL AS local_updated_at,
        NULL AS server_created_at,
        NULL AS server_updated_at,
        COALESCE(document_updates.pending_update_count, 0) AS pending_update_count,
        COALESCE(document_attachments.pending_attachment_count, 0) AS pending_attachment_count,
        COALESCE(document_attachments.pending_attachment_bytes, 0) AS pending_attachment_bytes,
        NULL AS sync_last_error,
        d.title AS name,
        d.document_kind AS type_sort,
        d.updated_at AS created_at,
        d.updated_at AS updated_at
      FROM document_container_projection linked
      INNER JOIN document_projection d ON d.document_id = linked.document_id
      LEFT JOIN document_pending_update_counts document_updates
        ON document_updates.local_id = d.local_id
      LEFT JOIN document_pending_attachment_counts document_attachments
        ON document_attachments.local_id = d.local_id
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

function getContainerDocumentsContainerDocumentsBaseSql(): string {
  return `
    WITH ${getContainerDocumentsDocumentPendingStateCtes()},
    container_documents AS (
      SELECT
        d.local_id AS local_id,
        d.document_id AS document_id,
        d.container_id AS container_id,
        d.document_kind AS document_kind,
        COALESCE(document_updates.pending_update_count, 0) AS pending_update_count,
        COALESCE(document_attachments.pending_attachment_count, 0) AS pending_attachment_count,
        COALESCE(document_attachments.pending_attachment_bytes, 0) AS pending_attachment_bytes,
        d.title AS title,
        d.updated_at AS updated_at
      FROM document_projection d
      LEFT JOIN document_pending_update_counts document_updates
        ON document_updates.local_id = d.local_id
      LEFT JOIN document_pending_attachment_counts document_attachments
        ON document_attachments.local_id = d.local_id
      WHERE d.container_id = ?

      UNION ALL

      SELECT
        d.local_id AS local_id,
        d.document_id AS document_id,
        linked.container_id AS container_id,
        d.document_kind AS document_kind,
        COALESCE(document_updates.pending_update_count, 0) AS pending_update_count,
        COALESCE(document_attachments.pending_attachment_count, 0) AS pending_attachment_count,
        COALESCE(document_attachments.pending_attachment_bytes, 0) AS pending_attachment_bytes,
        d.title AS title,
        d.updated_at AS updated_at
      FROM document_container_projection linked
      INNER JOIN document_projection d ON d.document_id = linked.document_id
      LEFT JOIN document_pending_update_counts document_updates
        ON document_updates.local_id = d.local_id
      LEFT JOIN document_pending_attachment_counts document_attachments
        ON document_attachments.local_id = d.local_id
      WHERE linked.container_id = ?
        AND (
          d.container_id IS NULL
          OR d.container_id != linked.container_id
        )
    )
    SELECT *
    FROM container_documents
  `;
}

function getContainerDocumentsContainerDocumentSidebarOrderBy(): string {
  return "updated_at IS NULL ASC, updated_at DESC, title COLLATE NOCASE ASC, local_id ASC";
}

function parseContainerDocumentsContainerItemDocumentKind(
  value: unknown,
): StoredDocumentKind {
  return typeof value === "string" && value.trim().length > 0 ? value : "note";
}

function readContainerDocumentsContainerItemString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readContainerDocumentsContainerItemNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readContainerDocumentsContainerItemNumber(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasPendingLocalTimestamp(
  row: Record<string, unknown>,
  localUpdatedAtKey: string,
  serverUpdatedAtKey: string,
): boolean {
  const localUpdatedAt = readContainerDocumentsContainerItemNullableString(
    row,
    localUpdatedAtKey,
  );
  const serverUpdatedAt = readContainerDocumentsContainerItemNullableString(
    row,
    serverUpdatedAtKey,
  );

  return (
    localUpdatedAt !== null &&
    (serverUpdatedAt === null ||
      localUpdatedAt.localeCompare(serverUpdatedAt) > 0)
  );
}

function readContainerDocumentObjectSyncState(
  row: Record<string, unknown>,
  options: {
    localOnly: boolean;
    localTimestampPending?: boolean | undefined;
  },
): ContainerDocumentObjectSyncState {
  return createContainerDocumentObjectSyncState({
    lastError: readContainerDocumentsContainerItemNullableString(
      row,
      "sync_last_error",
    ),
    localOnly: options.localOnly,
    pendingAttachmentBytes: readContainerDocumentsContainerItemNumber(
      row,
      "pending_attachment_bytes",
    ),
    pendingAttachmentCount: readContainerDocumentsContainerItemNumber(
      row,
      "pending_attachment_count",
    ),
    pendingUpdateCount: Math.max(
      readContainerDocumentsContainerItemNumber(row, "pending_update_count"),
      options.localTimestampPending ? 1 : 0,
    ),
  });
}

function mapContainerItemRow(
  containerId: string,
  row: Record<string, unknown>,
): ContainerItemRow {
  const itemKind = readContainerDocumentsContainerItemString(row, "item_kind");
  if (itemKind === "container") {
    return {
      createdAt: readContainerDocumentsContainerItemNullableString(
        row,
        "created_at",
      ),
      id: readContainerDocumentsContainerItemString(row, "item_id"),
      itemKind: "container",
      name: readContainerDocumentsContainerItemString(row, "name"),
      syncState: readContainerDocumentObjectSyncState(row, {
        localOnly:
          !readContainerDocumentsContainerItemNullableString(
            row,
            "server_created_at",
          ) ||
          !readContainerDocumentsContainerItemNullableString(
            row,
            "metadata_document_id",
          ),
        localTimestampPending: hasPendingLocalTimestamp(
          row,
          "local_updated_at",
          "server_updated_at",
        ),
      }),
      updatedAt: readContainerDocumentsContainerItemNullableString(
        row,
        "updated_at",
      ),
    };
  }

  return {
    containerId,
    createdAt: readContainerDocumentsContainerItemNullableString(
      row,
      "created_at",
    ),
    documentId: readContainerDocumentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerDocumentsContainerItemDocumentKind(
      readContainerDocumentsContainerItemString(row, "document_kind"),
    ),
    itemKind: "document",
    localId: readContainerDocumentsContainerItemString(row, "item_id"),
    name: readContainerDocumentsContainerItemString(row, "name"),
    syncState: readContainerDocumentObjectSyncState(row, {
      localOnly: !readContainerDocumentsContainerItemNullableString(
        row,
        "document_id",
      ),
    }),
    updatedAt: readContainerDocumentsContainerItemNullableString(
      row,
      "updated_at",
    ),
  };
}

function readContainerDocumentsContainerItemCount(
  row: Record<string, unknown>,
): number {
  return readContainerDocumentsContainerItemNumber(row, "total_count");
}

function mapContainerDocumentSidebarRow(
  row: Record<string, unknown>,
): ContainerDocumentSidebarRow {
  return {
    containerId: readContainerDocumentsContainerItemString(row, "container_id"),
    documentId: readContainerDocumentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerDocumentsContainerItemDocumentKind(
      readContainerDocumentsContainerItemString(row, "document_kind"),
    ),
    localId: readContainerDocumentsContainerItemString(row, "local_id"),
    syncState: readContainerDocumentObjectSyncState(row, {
      localOnly: !readContainerDocumentsContainerItemNullableString(
        row,
        "document_id",
      ),
    }),
    title: readContainerDocumentsContainerItemString(row, "title"),
    updatedAt: readContainerDocumentsContainerItemNullableString(
      row,
      "updated_at",
    ),
  };
}

function mapContainerDocumentsDocumentSummaryRow(
  row: Record<string, unknown>,
): DocumentSummary | null {
  const localId = readContainerDocumentsContainerItemString(row, "local_id");
  if (localId.length === 0) {
    return null;
  }

  return {
    accessStateHash: readContainerDocumentsContainerItemNullableString(
      row,
      "access_state_hash",
    ),
    id: localId,
    containerId: readContainerDocumentsContainerItemNullableString(
      row,
      "container_id",
    ),
    documentId: readContainerDocumentsContainerItemNullableString(
      row,
      "document_id",
    ),
    documentKind: parseContainerDocumentsContainerItemDocumentKind(
      readContainerDocumentsContainerItemString(row, "document_kind"),
    ),
    title: readContainerDocumentsContainerItemString(row, "title"),
    updatedAt: readContainerDocumentsContainerItemString(row, "updated_at"),
  };
}

function addContainerDocumentsDocumentSummaries(
  documentSummariesById: Map<string, DocumentSummary>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): void {
  for (const documentSummary of documentSummaries) {
    documentSummariesById.set(documentSummary.id, documentSummary);
  }
}

async function listContainerDocumentsDocumentIdsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<string[]> {
  const documentIds = new Set<string>();

  for (const containerIdBatch of listContainerDocumentsSqlIdBatches(
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

async function listContainerDocumentsDocumentSummariesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const documentSummariesById = new Map<string, DocumentSummary>();

  for (const containerIdBatch of listContainerDocumentsSqlIdBatches(
    input.containerIds,
  )) {
    addContainerDocumentsDocumentSummaries(
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

  for (const documentIdBatch of listContainerDocumentsSqlIdBatches(
    input.documentIds,
  )) {
    addContainerDocumentsDocumentSummaries(
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
    compareContainerDocumentsDocumentSummaries,
  );
}

async function listContainerItemWindow(
  execSql: ExecSql,
  input: {
    containerId: string;
    limit: number;
    offset: number;
    sort: ContainerItemSort;
  },
): Promise<ContainerItemWindow> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, containerCreateIntentTables);

  const limit = getContainerItemWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const bind = [input.containerId, input.containerId, input.containerId];
  const baseSql = getContainerDocumentsContainerItemsBaseSql();
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readContainerDocumentsContainerItemCount(
    countRows[0] ?? {},
  );

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getContainerDocumentsContainerItemOrderBy(input.sort)} LIMIT ? OFFSET ?`,
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
  const baseSql = getContainerDocumentsContainerDocumentsBaseSql();
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readContainerDocumentsContainerItemCount(
    countRows[0] ?? {},
  );

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getContainerDocumentsContainerDocumentSidebarOrderBy()} LIMIT ? OFFSET ?`,
    [...bind, limit, offset],
  );

  return {
    rows: rows.map(mapContainerDocumentSidebarRow),
    totalCount,
  };
}

async function loadContainerDocumentsDocumentSummary(
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
        stored.access_state_hash AS access_state_hash
      FROM document_projection d
      LEFT JOIN documents stored
        ON stored.app_kind = 'documents'
        AND stored.local_id = d.local_id
      WHERE d.local_id = ?
      LIMIT 1
    `,
    [localId],
  );

  return mapContainerDocumentsDocumentSummaryRow(rows[0] ?? {});
}

async function loadContainerDocumentsDocumentSyncState(
  execSql: ExecSql,
  localId: string,
): Promise<ContainerDocumentObjectSyncState | null> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const rows = await execSql(
    `
      WITH ${getContainerDocumentsDocumentPendingStateCtes()}
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

  return readContainerDocumentObjectSyncState(row, {
    localOnly: !readContainerDocumentsContainerItemNullableString(
      row,
      "document_id",
    ),
  });
}

async function listContainerDocumentsDocumentsForContainerSubtree(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ContainerDocumentsSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds =
    await listContainerDocumentsDocumentIdsByContainerIds(
      execSql,
      containerIds,
    );
  const documentSummaries =
    await listContainerDocumentsDocumentSummariesByContainerIdsOrDocumentIds(
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

function listContainerDocumentsContainerSubtreeIds(
  containersById: ReadonlyMap<string, ContainerDocumentsContainerSubtreeState>,
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

function resolveContainerDocumentsDocumentRuntimeContainerId(params: {
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
  containersById: ReadonlyMap<string, ContainerDocumentsContainerSubtreeState>;
  execSql: ExecSql;
  rootContainerId: string;
}): Promise<ContainerDocumentsDocumentRuntimeTarget[]> {
  const { containersById, execSql, rootContainerId } = input;
  const sharedContainerIds = new Set(
    listContainerDocumentsContainerSubtreeIds(containersById, rootContainerId),
  );
  if (sharedContainerIds.size === 0) {
    return [];
  }

  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listContainerDocumentsDocumentsForContainerSubtree(
      execSql,
      Array.from(sharedContainerIds),
    );

  return documentSummaries.flatMap((documentSummary) => {
    const runtimeContainerId =
      resolveContainerDocumentsDocumentRuntimeContainerId({
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
  runtime: ContainerDocumentReadModelRuntime;
}): ReturnType<typeof listDocumentRuntimeTargetsForContainerSubtree> {
  const execSql = getContainerDocumentsWorkflowRuntimeExecSql(runtime);
  return listDocumentRuntimeTargetsForContainerSubtree({
    ...input,
    execSql,
  });
}

export async function primeDocumentsForContainerSubtree<TRuntime>(input: {
  containersById: ReadonlyMap<string, ContainerDocumentsContainerSubtreeState>;
  host: ContainerDocumentPrimeHost<TRuntime>;
  rootContainerId: string;
  runtime: ContainerDocumentReadModelRuntime;
}): Promise<number> {
  const targets =
    await listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
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

async function listContainerDocumentsLinkedContainerIdsByDocumentIds(
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

  for (const documentIdBatch of listContainerDocumentsSqlIdBatches(
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

function loadContainerDocumentsContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(
    execSql,
    containerDocumentsSyncLane(containerId),
  );
}

function replaceDocumentLinks(
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
    containerDocumentsSyncLane(containerId),
    watermark,
  );
}

function upsertDiscoveredContainerDocumentsDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return upsertDiscoveredDocuments(execSql, inputs);
}

function createContainerDocumentReadModel(
  execSql: ExecSql,
): ContainerDocumentReadModel {
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
      return loadContainerDocumentsDocumentSyncState(execSql, localId);
    },
    loadDocumentSummary(localId) {
      return loadContainerDocumentsDocumentSummary(execSql, localId);
    },
    loadContainerDocumentWatermark(containerId) {
      return loadContainerDocumentsContainerDocumentWatermark(
        execSql,
        containerId,
      );
    },
    listLinkedContainerIdsByDocumentIds(documentIds) {
      return listContainerDocumentsLinkedContainerIdsByDocumentIds(
        execSql,
        documentIds,
      );
    },
    replaceDocumentLinks(documentId, linkedContainerIds) {
      return replaceDocumentLinks(execSql, documentId, linkedContainerIds);
    },
    replaceDocumentLinksBatch(inputs) {
      return replaceDocumentLinksBatch(execSql, inputs);
    },
    saveContainerDocumentWatermark(containerId, watermark) {
      return saveContainerDocumentWatermark(execSql, containerId, watermark);
    },
    upsertDiscoveredDocuments(inputs) {
      return upsertDiscoveredContainerDocumentsDocuments(execSql, inputs);
    },
  };
}

export function createContainerDocumentReadModelFromRuntime(
  runtime: ContainerDocumentReadModelRuntime,
): ContainerDocumentReadModel {
  return createContainerDocumentReadModel(
    getContainerDocumentsWorkflowRuntimeExecSql(runtime),
  );
}
