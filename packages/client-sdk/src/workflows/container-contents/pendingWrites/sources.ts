import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  getContainerDisplayNameSql,
  getContainerOrganizationAttributionSql,
} from "../documentQueries/sql";
import type {
  PendingWriteCandidate,
  PendingWriteCandidateInclusion,
} from "./aggregation";
import { readNumber, readString } from "./rowReaders";

const CONTAINER_DISPLAY_NAME_SQL = getContainerDisplayNameSql({
  containerAlias: "container",
  projectionAlias: "container_projection",
});
const DOCUMENT_ORGANIZATION_SQL = getContainerOrganizationAttributionSql({
  containerAlias: "container",
  projectionAlias: "projection",
});

const PENDING_WRITE_SOURCE_SQL = `
  WITH pending_update_groups AS (
    SELECT
      app_kind,
      local_id,
      COUNT(*) AS operation_count,
      MIN(created_at) AS created_at,
      MAX(created_at) AS updated_at
    FROM document_pending_updates
    GROUP BY app_kind, local_id
  )
  SELECT
    'document' AS object_kind,
    NULL AS namespace,
    updates.local_id AS local_id,
    stored.document_id AS remote_id,
    projection.title AS name,
    projection.container_id AS container_id,
    ${DOCUMENT_ORGANIZATION_SQL} AS organization_id,
    'update' AS operation_kind,
    updates.operation_count AS operation_count,
    0 AS byte_length,
    updates.created_at AS created_at,
    updates.updated_at AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM pending_update_groups updates
  LEFT JOIN documents stored
    ON stored.app_kind = 'documents'
    AND stored.local_id = updates.local_id
  LEFT JOIN document_projection projection
    ON projection.local_id = updates.local_id
  LEFT JOIN containers container
    ON container.id = projection.container_id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = 'documents'
    AND failure.local_id = updates.local_id
  WHERE updates.app_kind = 'documents'

  UNION ALL

  -- Failure-only surface (edge-case row 13): a refused read-only
  -- revalidation records a durable failure row with NO pending work, so
  -- without this branch the refusal would never reach the queue view. The
  -- 'unless-item-covered' inclusion keeps it out whenever the document
  -- already has real operations — those candidates carry the same failure
  -- message through their own joins.
  SELECT
    'document' AS object_kind,
    NULL AS namespace,
    failure.local_id AS local_id,
    stored.document_id AS remote_id,
    projection.title AS name,
    projection.container_id AS container_id,
    ${DOCUMENT_ORGANIZATION_SQL} AS organization_id,
    'revalidation' AS operation_kind,
    0 AS operation_count,
    0 AS byte_length,
    failure.attempted_at AS created_at,
    failure.attempted_at AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'unless-item-covered' AS inclusion
  FROM document_sync_failures failure
  LEFT JOIN documents stored
    ON stored.app_kind = failure.app_kind
    AND stored.local_id = failure.local_id
  LEFT JOIN document_projection projection
    ON projection.local_id = failure.local_id
  LEFT JOIN containers container
    ON container.id = projection.container_id
  WHERE failure.app_kind = 'documents'

  UNION ALL

  SELECT
    'container' AS object_kind,
    NULL AS namespace,
    updates.local_id AS local_id,
    CASE WHEN container.server_created_at IS NULL THEN NULL ELSE container.id END AS remote_id,
    ${CONTAINER_DISPLAY_NAME_SQL} AS name,
    container.id AS container_id,
    NULLIF(container.organization_id, '') AS organization_id,
    'update' AS operation_kind,
    updates.operation_count AS operation_count,
    0 AS byte_length,
    updates.created_at AS created_at,
    updates.updated_at AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM pending_update_groups updates
  LEFT JOIN containers container ON container.id = updates.local_id
  LEFT JOIN container_projection
    ON container_projection.container_id = updates.local_id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = 'container-metadata'
    AND failure.local_id = updates.local_id
  WHERE updates.app_kind = 'container-metadata'
    -- Dormant retained metadata (container tombstoned access_revoked, row 4)
    -- has no containers row; keep it unsurfaced until rehydration re-attaches
    -- the container, or it renders as an anonymous phantom item.
    AND container.id IS NOT NULL

  UNION ALL

  SELECT
    'unknown' AS object_kind,
    updates.app_kind AS namespace,
    updates.local_id AS local_id,
    stored.document_id AS remote_id,
    NULL AS name,
    NULL AS container_id,
    NULL AS organization_id,
    'update' AS operation_kind,
    updates.operation_count AS operation_count,
    0 AS byte_length,
    updates.created_at AS created_at,
    updates.updated_at AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM pending_update_groups updates
  LEFT JOIN documents stored
    ON stored.app_kind = updates.app_kind
    AND stored.local_id = updates.local_id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = updates.app_kind
    AND failure.local_id = updates.local_id
  WHERE updates.app_kind NOT IN ('documents', 'container-metadata')

  UNION ALL

  SELECT
    'document' AS object_kind,
    NULL AS namespace,
    attachment.local_id AS local_id,
    stored.document_id AS remote_id,
    projection.title AS name,
    projection.container_id AS container_id,
    ${DOCUMENT_ORGANIZATION_SQL} AS organization_id,
    'attachment' AS operation_kind,
    COUNT(*) AS operation_count,
    COALESCE(SUM(attachment.byte_length), 0) AS byte_length,
    MIN(attachment.created_at) AS created_at,
    MAX(attachment.created_at) AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM document_pending_attachments attachment
  LEFT JOIN documents stored
    ON stored.app_kind = 'documents'
    AND stored.local_id = attachment.local_id
  LEFT JOIN document_projection projection
    ON projection.local_id = attachment.local_id
  LEFT JOIN containers container
    ON container.id = projection.container_id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = 'documents'
    AND failure.local_id = attachment.local_id
  GROUP BY attachment.local_id

  UNION ALL

  SELECT
    'container' AS object_kind,
    NULL AS namespace,
    intent.container_id AS local_id,
    COALESCE(intent.remote_container_id, CASE WHEN container.server_created_at IS NULL THEN NULL ELSE container.id END) AS remote_id,
    ${CONTAINER_DISPLAY_NAME_SQL} AS name,
    intent.container_id AS container_id,
    NULLIF(container.organization_id, '') AS organization_id,
    'create' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    intent.created_at AS created_at,
    intent.updated_at AS updated_at,
    intent.parent_container_id AS target_container_id,
    'pending' AS operation_status,
    intent.last_error AS last_error,
    intent.last_attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM container_create_intents intent
  LEFT JOIN containers container ON container.id = intent.container_id
  LEFT JOIN container_projection
    ON container_projection.container_id = intent.container_id
  WHERE intent.intent_type = 'container.create'
    AND intent.sync_status = 'pending'

  UNION ALL

  SELECT
    'container' AS object_kind,
    NULL AS namespace,
    intent.container_id AS local_id,
    CASE WHEN container.server_created_at IS NULL THEN NULL ELSE container.id END AS remote_id,
    ${CONTAINER_DISPLAY_NAME_SQL} AS name,
    intent.container_id AS container_id,
    NULLIF(container.organization_id, '') AS organization_id,
    'move' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    intent.created_at AS created_at,
    intent.updated_at AS updated_at,
    intent.parent_container_id AS target_container_id,
    CASE WHEN intent.sync_status = 'blocked' THEN 'blocked' ELSE 'pending' END AS operation_status,
    intent.last_error AS last_error,
    intent.last_attempted_at AS last_attempted_at,
    'always' AS inclusion
  FROM container_move_intents intent
  LEFT JOIN containers container ON container.id = intent.container_id
  LEFT JOIN container_projection
    ON container_projection.container_id = intent.container_id
  WHERE intent.intent_type = 'container.move'

  UNION ALL

  SELECT
    'document' AS object_kind,
    NULL AS namespace,
    intent.local_id AS local_id,
    intent.document_id AS remote_id,
    projection.title AS name,
    COALESCE(projection.container_id, intent.target_container_id) AS container_id,
    ${DOCUMENT_ORGANIZATION_SQL} AS organization_id,
    'move' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    intent.created_at AS created_at,
    intent.updated_at AS updated_at,
    intent.target_container_id AS target_container_id,
    CASE WHEN intent.sync_status = 'blocked' THEN 'blocked' ELSE 'pending' END AS operation_status,
    COALESCE(NULLIF(intent.last_error, ''), failure.message) AS last_error,
    COALESCE(intent.last_attempted_at, failure.attempted_at) AS last_attempted_at,
    'always' AS inclusion
  FROM document_move_intents intent
  LEFT JOIN document_projection projection
    ON projection.local_id = intent.local_id
  LEFT JOIN containers container
    ON container.id = COALESCE(projection.container_id, intent.target_container_id)
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = 'documents'
    AND failure.local_id = intent.local_id
  WHERE intent.intent_type = 'document.move'

  UNION ALL

  SELECT
    'document' AS object_kind,
    NULL AS namespace,
    stored.local_id AS local_id,
    NULL AS remote_id,
    projection.title AS name,
    projection.container_id AS container_id,
    ${DOCUMENT_ORGANIZATION_SQL} AS organization_id,
    'create' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    stored.updated_at AS created_at,
    stored.updated_at AS updated_at,
    projection.container_id AS target_container_id,
    'pending' AS operation_status,
    failure.message AS last_error,
    failure.attempted_at AS last_attempted_at,
    'unless-operation-covered' AS inclusion
  FROM documents stored
  LEFT JOIN document_projection projection
    ON projection.local_id = stored.local_id
  LEFT JOIN containers container
    ON container.id = projection.container_id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = 'documents'
    AND failure.local_id = stored.local_id
  WHERE stored.app_kind = 'documents'
    AND stored.document_id IS NULL

  UNION ALL

  SELECT
    'container' AS object_kind,
    NULL AS namespace,
    container.id AS local_id,
    CASE WHEN container.server_created_at IS NULL THEN NULL ELSE container.id END AS remote_id,
    ${CONTAINER_DISPLAY_NAME_SQL} AS name,
    container.id AS container_id,
    NULLIF(container.organization_id, '') AS organization_id,
    'create' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    container.local_created_at AS created_at,
    container.local_updated_at AS updated_at,
    container.parent_id AS target_container_id,
    'pending' AS operation_status,
    NULL AS last_error,
    NULL AS last_attempted_at,
    'unless-operation-covered' AS inclusion
  FROM containers container
  LEFT JOIN container_projection
    ON container_projection.container_id = container.id
  LEFT JOIN documents metadata
    ON metadata.app_kind = 'container-metadata'
    AND metadata.local_id = container.id
  WHERE container.server_created_at IS NULL
    OR container.metadata_document_id IS NULL
    OR metadata.document_id IS NULL

  UNION ALL

  SELECT
    'container' AS object_kind,
    NULL AS namespace,
    container.id AS local_id,
    CASE WHEN container.server_created_at IS NULL THEN NULL ELSE container.id END AS remote_id,
    ${CONTAINER_DISPLAY_NAME_SQL} AS name,
    container.id AS container_id,
    NULLIF(container.organization_id, '') AS organization_id,
    'update' AS operation_kind,
    1 AS operation_count,
    0 AS byte_length,
    NULL AS created_at,
    container.local_updated_at AS updated_at,
    NULL AS target_container_id,
    'pending' AS operation_status,
    NULL AS last_error,
    NULL AS last_attempted_at,
    'unless-item-covered' AS inclusion
  FROM containers container
  LEFT JOIN container_projection
    ON container_projection.container_id = container.id
  WHERE container.local_updated_at IS NOT NULL
    AND (
      container.server_updated_at IS NULL
      OR container.local_updated_at > container.server_updated_at
    )
`;

function mapPendingWriteSourceRow(
  row: Record<string, unknown>,
): PendingWriteCandidate | null {
  const localId = readString(row, "local_id");
  const operationKind = readString(row, "operation_kind");
  if (
    !localId ||
    (operationKind !== "attachment" &&
      operationKind !== "create" &&
      operationKind !== "move" &&
      operationKind !== "revalidation" &&
      operationKind !== "update")
  ) {
    return null;
  }
  const rawObjectKind = readString(row, "object_kind");
  const objectKind =
    rawObjectKind === "container" || rawObjectKind === "document"
      ? rawObjectKind
      : "unknown";
  const rawInclusion = readString(row, "inclusion");
  const inclusion: PendingWriteCandidateInclusion =
    rawInclusion === "unless-item-covered" ||
    rawInclusion === "unless-operation-covered"
      ? rawInclusion
      : "always";

  return {
    byteLength: readNumber(row, "byte_length"),
    containerId: readString(row, "container_id"),
    // Diagnostic-only revalidation items carry NO local operations; clamping
    // them to 1 would falsely report pending local data.
    count:
      operationKind === "revalidation"
        ? 0
        : Math.max(1, readNumber(row, "operation_count")),
    createdAt: readString(row, "created_at"),
    inclusion,
    kind: operationKind,
    lastAttemptedAt: readString(row, "last_attempted_at"),
    lastError: readString(row, "last_error"),
    localId,
    name: readString(row, "name"),
    namespace: readString(row, "namespace"),
    objectKind,
    organizationId: readString(row, "organization_id"),
    remoteId: readString(row, "remote_id"),
    status:
      readString(row, "operation_status") === "blocked" ? "blocked" : "pending",
    targetContainerId: readString(row, "target_container_id"),
    updatedAt: readString(row, "updated_at"),
  };
}

export async function listPersistedPendingWriteCandidates(
  execSql: ExecSql,
): Promise<PendingWriteCandidate[]> {
  const rows = await execSql(PENDING_WRITE_SOURCE_SQL);
  return rows.flatMap((row) => {
    const candidate = mapPendingWriteSourceRow(row);
    return candidate ? [candidate] : [];
  });
}
