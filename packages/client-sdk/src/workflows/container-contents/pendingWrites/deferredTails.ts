import { mergeVersionVectors, satisfiesVersionVector } from "@tearleads/loro";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { PendingWriteQueueObjectKind } from "../pendingWritesTypes";
import type { PendingWriteCandidate } from "./aggregation";

// Deliberately never loads document content: the diagnostic listing runs
// repeatedly while sync drains, and materializing every content blob would
// make the scan O(total document content). `snapshot_end_version` is the
// write-time-derived end version vector of the persisted content.
const DEFERRED_TAIL_CANDIDATE_SQL = `
  SELECT
    stored.app_kind AS app_kind,
    stored.local_id AS local_id,
    stored.document_id AS stored_remote_id,
    stored.snapshot_end_version AS snapshot_end_version,
    stored.pending_base_version AS pending_base_version,
    stored.updated_at AS updated_at,
    (
      SELECT pending.partial_end_version_vector
      FROM document_pending_updates pending
      WHERE pending.app_kind = stored.app_kind
        AND pending.local_id = stored.local_id
      ORDER BY pending.created_at DESC, pending.rowid DESC
      LIMIT 1
    ) AS latest_pending_end_version,
    document_projection.title AS document_name,
    document_projection.container_id AS document_container_id,
    COALESCE(
      NULLIF(document_container.organization_id, ''),
      NULLIF(document_projection.organization_id, '')
    ) AS document_organization_id,
    CASE
      WHEN metadata_container.server_created_at IS NULL THEN NULL
      ELSE metadata_container.id
    END AS container_remote_id,
    COALESCE(
      container_projection.display_name,
      CASE WHEN metadata_container.parent_id IS NULL THEN '/' ELSE 'Untitled' END
    ) AS container_name,
    metadata_container.id AS metadata_container_id,
    NULLIF(metadata_container.organization_id, '') AS metadata_organization_id,
    failure.message AS failure_message,
    failure.attempted_at AS failure_attempted_at
  FROM documents stored
  LEFT JOIN document_projection
    ON stored.app_kind = 'documents'
    AND document_projection.local_id = stored.local_id
  LEFT JOIN containers document_container
    ON document_container.id = document_projection.container_id
  LEFT JOIN containers metadata_container
    ON stored.app_kind = 'container-metadata'
    AND metadata_container.id = stored.local_id
  LEFT JOIN container_projection
    ON container_projection.container_id = metadata_container.id
  LEFT JOIN document_sync_failures failure
    ON failure.app_kind = stored.app_kind
    AND failure.local_id = stored.local_id
  WHERE stored.snapshot_end_version <> ''
    -- Dormant retained metadata (row 4, access_revoked) has no containers
    -- row; keep it out of deferred-tail candidates until re-attach, matching
    -- the pending-write sources guard.
    AND (stored.app_kind <> 'container-metadata'
      OR metadata_container.id IS NOT NULL)
    AND (
      stored.pending_base_version IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM document_pending_updates pending
        WHERE pending.app_kind = stored.app_kind
          AND pending.local_id = stored.local_id
      )
    )
`;

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasUncoveredTail(input: {
  currentVersion: string;
  latestPendingEndVersion: string | null;
  pendingBaseVersion: string | null;
}): boolean {
  const coverageVersions = [
    input.latestPendingEndVersion,
    input.pendingBaseVersion,
  ].filter((value): value is string => value !== null);
  const validCoverageVersions: string[] = [];
  for (const coverageVersion of coverageVersions) {
    try {
      validCoverageVersions.push(mergeVersionVectors([coverageVersion]));
    } catch {
      // Corrupt coverage must not make the diagnostic claim an uncovered write.
      return false;
    }
  }
  if (validCoverageVersions.length === 0) {
    return false;
  }

  try {
    const mergedCoverage = mergeVersionVectors(validCoverageVersions);
    return !satisfiesVersionVector(mergedCoverage, input.currentVersion);
  } catch {
    // Corrupt coverage must not make the diagnostic claim an uncovered write.
    return false;
  }
}

function getObjectKind(appKind: string): PendingWriteQueueObjectKind {
  if (appKind === "documents") return "document";
  if (appKind === "container-metadata") return "container";
  return "unknown";
}

function mapDeferredTailCandidate(
  row: Record<string, unknown>,
): PendingWriteCandidate | null {
  const appKind = readString(row, "app_kind");
  const localId = readString(row, "local_id");
  const currentVersion = readString(row, "snapshot_end_version");
  if (!appKind || !localId || !currentVersion) {
    return null;
  }
  if (
    !hasUncoveredTail({
      currentVersion,
      latestPendingEndVersion: readString(row, "latest_pending_end_version"),
      pendingBaseVersion: readString(row, "pending_base_version"),
    })
  ) {
    return null;
  }

  const objectKind = getObjectKind(appKind);
  const updatedAt = readString(row, "updated_at");
  return {
    byteLength: 0,
    containerId:
      objectKind === "container"
        ? readString(row, "metadata_container_id")
        : objectKind === "document"
          ? readString(row, "document_container_id")
          : null,
    count: 1,
    createdAt: updatedAt,
    inclusion: "always",
    kind: "deferred-update",
    // Carry the scope's recorded sync failure so a covering deferred-update
    // candidate never hides the diagnostic a suppressed failure-only item
    // would have shown.
    lastAttemptedAt: readString(row, "failure_attempted_at"),
    lastError: readString(row, "failure_message"),
    localId,
    name:
      objectKind === "container"
        ? readString(row, "container_name")
        : objectKind === "document"
          ? readString(row, "document_name")
          : null,
    namespace: objectKind === "unknown" ? appKind : null,
    objectKind,
    organizationId:
      objectKind === "container"
        ? readString(row, "metadata_organization_id")
        : objectKind === "document"
          ? readString(row, "document_organization_id")
          : null,
    remoteId:
      objectKind === "container"
        ? readString(row, "container_remote_id")
        : readString(row, "stored_remote_id"),
    status: "pending",
    targetContainerId: null,
    updatedAt,
  };
}

export async function listDeferredPendingWriteCandidates(
  execSql: ExecSql,
): Promise<PendingWriteCandidate[]> {
  const rows = await execSql(DEFERRED_TAIL_CANDIDATE_SQL);
  return rows.flatMap((row) => {
    const candidate = mapDeferredTailCandidate(row);
    return candidate ? [candidate] : [];
  });
}
