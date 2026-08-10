import { getOrphanedDocumentWhereSql } from "../orphanedDocumentSql";
import type { ContainerItemSort } from "./types";

// Keep each IN clause below SQLite's historical 999 bind-parameter limit.
const CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE = 500;
const MAX_CONTAINER_ITEM_WINDOW_LIMIT = 200;
const MAX_CONTAINER_DOCUMENT_SIDEBAR_WINDOW_LIMIT = 200;

export function listContainerContentsSqlIdBatches(
  values: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> {
  const batches: string[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE
  ) {
    batches.push(
      values.slice(index, index + CONTAINER_DOCUMENT_SQL_ID_BATCH_SIZE),
    );
  }

  return batches;
}

export function clampContainerItemWindowValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getContainerItemWindowLimit(limit: number): number {
  return Math.min(
    MAX_CONTAINER_ITEM_WINDOW_LIMIT,
    clampContainerItemWindowValue(limit),
  );
}

export function getContainerDocumentSidebarWindowLimit(limit: number): number {
  return Math.min(
    MAX_CONTAINER_DOCUMENT_SIDEBAR_WINDOW_LIMIT,
    clampContainerItemWindowValue(limit),
  );
}

export function getContainerContentsContainerItemOrderBy(
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

  if (sort.key === "name") {
    return `item_kind_sort ASC, name COLLATE NOCASE ${direction}, type_sort COLLATE NOCASE ASC, item_id ASC`;
  }

  return "item_kind_sort ASC, name COLLATE NOCASE ASC, type_sort COLLATE NOCASE ASC, item_id ASC";
}

export function getContainerContentsDocumentPendingStateCtes(): string {
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

interface ContainerSystemFilterCounts {
  visibleForeignSystemContainerNameCount: number;
  visibleSystemSlotCount: number;
}

export function getContainerDisplayNameSql(aliases: {
  containerAlias: string;
  projectionAlias: string;
}): string {
  return `COALESCE(${aliases.projectionAlias}.display_name, CASE WHEN ${aliases.containerAlias}.parent_id IS NULL THEN '/' ELSE 'Untitled' END)`;
}

/**
 * Display attribution for an object reached through a container: the
 * container's organization when attached, else the projection row's own.
 */
export function getContainerOrganizationAttributionSql(aliases: {
  containerAlias: string;
  projectionAlias: string;
}): string {
  return `COALESCE(NULLIF(${aliases.containerAlias}.organization_id, ''), NULLIF(${aliases.projectionAlias}.organization_id, ''))`;
}

function getContainerContentsContainerSystemSlotFilter(
  counts: ContainerSystemFilterCounts,
): string {
  const clauses = ["c.system_slot IS NULL"];

  if (counts.visibleSystemSlotCount > 0) {
    const visibleSystemSlotBindMarkers = Array.from(
      { length: counts.visibleSystemSlotCount },
      () => "?",
    ).join(", ");
    clauses.push(`c.system_slot IN (${visibleSystemSlotBindMarkers})`);
  }

  if (counts.visibleForeignSystemContainerNameCount > 0) {
    const visibleSystemNameBindMarkers = Array.from(
      { length: counts.visibleForeignSystemContainerNameCount },
      () => "?",
    ).join(", ");
    clauses.push(
      `(c.organization_id != '' AND c.organization_id != ? AND ${getContainerDisplayNameSql({ containerAlias: "c", projectionAlias: "cp" })} IN (${visibleSystemNameBindMarkers}))`,
    );
  }

  return `(${clauses.join(" OR ")})`;
}

export function getContainerContentsContainerItemsBaseSql(
  visibleSystemSlotCount = 0,
  visibleForeignSystemContainerNameCount = 0,
): string {
  return `
    WITH ${getContainerContentsDocumentPendingStateCtes()},
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
        cp.icon AS icon,
        COALESCE(container_updates.pending_update_count, 0) AS pending_update_count,
        0 AS pending_attachment_count,
        0 AS pending_attachment_bytes,
        create_intent.last_error AS sync_last_error,
        ${getContainerDisplayNameSql({ containerAlias: "c", projectionAlias: "cp" })} AS name,
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
        AND ${getContainerContentsContainerSystemSlotFilter({
          visibleForeignSystemContainerNameCount,
          visibleSystemSlotCount,
        })}

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
        NULL AS icon,
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
        NULL AS icon,
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

export function getContainerContentsDocumentRowsBaseSql(): string {
  return `
    WITH ${getContainerContentsDocumentPendingStateCtes()},
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

export function getOrphanedDocumentItemsBaseSql(): string {
  return `
    WITH ${getContainerContentsDocumentPendingStateCtes()},
    orphaned_document_items AS (
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
        NULL AS icon,
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
      WHERE ${getOrphanedDocumentWhereSql({
        documentIdSql: "d.document_id",
        projectionAlias: "d",
      })}
    )
    SELECT *
    FROM orphaned_document_items
  `;
}

export function getOrphanedDocumentRowsBaseSql(): string {
  return `
    WITH ${getContainerContentsDocumentPendingStateCtes()}
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
    WHERE ${getOrphanedDocumentWhereSql({
      documentIdSql: "d.document_id",
      projectionAlias: "d",
    })}
  `;
}

export function getOrphanedDocumentExistsSql(): string {
  return `
    SELECT 1
    FROM document_projection d
    WHERE ${getOrphanedDocumentWhereSql({
      documentIdSql: "d.document_id",
      projectionAlias: "d",
    })}
    LIMIT 1
  `;
}

export function getContainerContentsContainerDocumentSidebarOrderBy(): string {
  return "updated_at IS NULL ASC, updated_at DESC, title COLLATE NOCASE ASC, local_id ASC";
}
