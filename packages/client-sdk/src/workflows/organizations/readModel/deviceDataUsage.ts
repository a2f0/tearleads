import {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDocumentUsageCategory,
} from "@tearleads/validators/response";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { readRecordValue } from "../../../data/shared/recordReaders";
import { organizationReadModelTables } from "../../../data/sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  type SqlRow,
} from "../../../data/sqlite/sqlSchema";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "../organizationProfile";

export {
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  type OrganizationDocumentUsageCategory,
};

export interface OrganizationDeviceDocumentUsageCategoryBreakdown {
  readonly byteLength: number;
  readonly category: OrganizationDocumentUsageCategory;
  readonly documentCount: number;
}

/**
 * What this device stores for one organization, measured from local SQLite.
 * Field names mirror the synced `OrganizationDataUsage`, without update
 * counts: documents are counted once each, however many updates they hold.
 */
export interface OrganizationDeviceDataUsage {
  readonly organizationId: string;
  readonly documents: {
    /** Every category, in `ORGANIZATION_DOCUMENT_USAGE_CATEGORIES` order. */
    readonly breakdown: ReadonlyArray<OrganizationDeviceDocumentUsageCategoryBreakdown>;
    readonly byteLength: number;
    readonly documentCount: number;
  };
  readonly blobs: {
    readonly blobCount: number;
    readonly byteLength: number;
  };
  readonly totalByteLength: number;
}

// Attribution follows the rest of the SDK: a document belongs to its selected
// container's organization, else to the organization its projection last
// recorded; folder metadata belongs to its container, else to the dormant
// marker kept after access loss. Bytes are the stored sizes of the record's
// key and manifest columns, the history checkpoint and tail, and the projected
// text. Categories mirror the server's first-match rules, keyed by server
// document id so a profile synced from another device (stored under that id
// rather than a local alias) still classifies.
//
// Files are the bytes held in the blob store: a pending upload's bytes are
// staged before its row is written, and an attachment row is written only
// after its bytes are downloaded, so every live row names a stored file.
// Detached rows only await a remote unlink and no longer belong to a document.
// One file can back several rows, so files are counted once per storage key.
const DEVICE_DATA_USAGE_SQL = `
  WITH params AS (SELECT ? AS organization_id),
  organization_documents AS (
    SELECT
      stored.app_kind AS app_kind,
      stored.local_id AS local_id,
      COALESCE(
        NULLIF(stored.document_id, ''),
        NULLIF(projection.document_id, '')
      ) AS document_id,
      projection.document_kind AS document_kind,
      COALESCE(octet_length(stored.document_manifest_bundle), 0)
        + COALESCE(octet_length(stored.content_key_bundle), 0)
        + COALESCE(octet_length(stored.document_kek_targets), 0)
        AS record_byte_length
    FROM documents stored
    CROSS JOIN params
    LEFT JOIN document_projection projection
      ON stored.app_kind = '${DOCUMENTS_APP_KIND}'
      AND projection.local_id = stored.local_id
    LEFT JOIN containers placement
      ON placement.id = projection.container_id
    LEFT JOIN containers metadata_container
      ON stored.app_kind = '${CONTAINER_METADATA_APP_KIND}'
      AND metadata_container.id = stored.local_id
    LEFT JOIN dormant_container_metadata dormant
      ON stored.app_kind = '${CONTAINER_METADATA_APP_KIND}'
      AND dormant.container_id = stored.local_id
    WHERE CASE
      WHEN stored.app_kind = '${CONTAINER_METADATA_APP_KIND}' THEN COALESCE(
        NULLIF(metadata_container.organization_id, ''),
        NULLIF(dormant.organization_id, '')
      )
      WHEN stored.app_kind = '${DOCUMENTS_APP_KIND}' THEN COALESCE(
        NULLIF(placement.organization_id, ''),
        NULLIF(projection.organization_id, '')
      )
    END = params.organization_id
  ),
  organization_document_usage AS (
    SELECT
      CASE
        WHEN scoped.app_kind = '${CONTAINER_METADATA_APP_KIND}'
          THEN 'containerMetadata'
        WHEN EXISTS (
          SELECT 1 FROM organization_read_model_directory_users roster
          WHERE roster.organization_id = params.organization_id
            AND roster.profile_document_id = scoped.document_id
        ) THEN 'rosterProfiles'
        WHEN scoped.document_kind = '${ORGANIZATION_PROFILE_DOCUMENT_KIND}'
          OR EXISTS (
            SELECT 1 FROM organization_read_model_state organization
            WHERE organization.organization_id = params.organization_id
              AND organization.profile_document_id = scoped.document_id
          ) THEN 'organizationMetadata'
        ELSE 'user'
      END AS category,
      scoped.record_byte_length
        + COALESCE((
          SELECT SUM(octet_length(checkpoint.snapshot))
          FROM document_history_checkpoints checkpoint
          WHERE checkpoint.app_kind = scoped.app_kind
            AND checkpoint.local_id = scoped.local_id
        ), 0)
        + COALESCE((
          SELECT SUM(octet_length(tail.update_data))
          FROM document_history_updates tail
          WHERE tail.app_kind = scoped.app_kind
            AND tail.local_id = scoped.local_id
        ), 0)
        + COALESCE((
          SELECT octet_length(projected.text)
          FROM document_projection_text projected
          WHERE scoped.app_kind = '${DOCUMENTS_APP_KIND}'
            AND projected.local_id = scoped.local_id
        ), 0) AS byte_length
    FROM organization_documents scoped
    CROSS JOIN params
  ),
  stored_files AS (
    SELECT local_id, storage_key, byte_length
    FROM document_pending_attachments
    UNION ALL
    SELECT local_id, storage_key, byte_length
    FROM document_attachment_blob_projection
    WHERE detached_at IS NULL
  ),
  organization_files AS (
    SELECT stored_files.storage_key, MAX(stored_files.byte_length) AS byte_length
    FROM stored_files
    CROSS JOIN params
    INNER JOIN document_projection projection
      ON projection.local_id = stored_files.local_id
    LEFT JOIN containers placement
      ON placement.id = projection.container_id
    WHERE COALESCE(
      NULLIF(placement.organization_id, ''),
      NULLIF(projection.organization_id, '')
    ) = params.organization_id
    GROUP BY stored_files.storage_key
  )
  SELECT
    'documents' AS kind,
    category,
    COUNT(*) AS item_count,
    COALESCE(SUM(byte_length), 0) AS byte_length
  FROM organization_document_usage
  GROUP BY category
  UNION ALL
  SELECT
    'blobs' AS kind,
    NULL AS category,
    COUNT(*) AS item_count,
    COALESCE(SUM(byte_length), 0) AS byte_length
  FROM organization_files
`;

function readCount(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Device data usage returned an invalid ${column}`);
  }
  return value;
}

function isDocumentUsageCategory(
  value: unknown,
): value is OrganizationDocumentUsageCategory {
  return ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.some(
    (category) => category === value,
  );
}

/**
 * Measures the documents and files this device stores for one organization.
 * Read-only; rejects when the local read fails.
 */
export async function measureOrganizationDeviceDataUsage(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
}): Promise<OrganizationDeviceDataUsage> {
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  await ensureContainerTables(input.execSql);
  await ensureSqlTables(input.execSql, organizationReadModelTables);
  const rows = await input.execSql(DEVICE_DATA_USAGE_SQL, [
    input.organizationId,
  ]);

  const documentsByCategory = new Map<
    OrganizationDocumentUsageCategory,
    { byteLength: number; documentCount: number }
  >();
  let blobs = { blobCount: 0, byteLength: 0 };
  for (const row of rows) {
    const byteLength = readCount(row, "byte_length");
    const itemCount = readCount(row, "item_count");
    const category = readRecordValue(row, "category");
    if (readRecordValue(row, "kind") === "blobs") {
      blobs = { blobCount: itemCount, byteLength };
    } else if (isDocumentUsageCategory(category)) {
      documentsByCategory.set(category, {
        byteLength,
        documentCount: itemCount,
      });
    } else {
      throw new Error("Device data usage returned an unknown category");
    }
  }

  const breakdown = ORGANIZATION_DOCUMENT_USAGE_CATEGORIES.map((category) => ({
    byteLength: documentsByCategory.get(category)?.byteLength ?? 0,
    category,
    documentCount: documentsByCategory.get(category)?.documentCount ?? 0,
  }));
  const documents = {
    breakdown,
    byteLength: breakdown.reduce((sum, entry) => sum + entry.byteLength, 0),
    documentCount: breakdown.reduce(
      (sum, entry) => sum + entry.documentCount,
      0,
    ),
  };
  return {
    blobs,
    documents,
    organizationId: input.organizationId,
    totalByteLength: documents.byteLength + blobs.byteLength,
  };
}
