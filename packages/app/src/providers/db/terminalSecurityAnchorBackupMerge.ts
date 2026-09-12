import {
  mapBackupRowsByScope,
  requireBackupHash,
  requireBackupPositiveInteger,
  requireBackupString,
  requireBackupTimestamp,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import { readProperty } from "./localBackupPayload";
import {
  incidentIdentityColumns,
  retainSecurityIncidentBackupRows,
  validateRestoredIncidentTimes,
  validateSecurityIncidentBackupIdentity,
} from "./securityIncidentBackupValidation";

export const DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME =
  "document_purge_checkpoints";
export const SECURITY_INCIDENT_TABLE_NAME = "security_incidents";

type Tables = {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
};

function mergeEvidenceTables(
  input: Tables,
  definition: {
    readonly tableName: string;
    readonly label: string;
    readonly keyColumn: string;
    readonly columns: readonly string[];
    readonly immutableColumns: readonly string[];
    readonly validateRow: (row: BackupSqlRow) => void;
    readonly mergeRow?: (
      current: BackupSqlRow,
      restored: BackupSqlRow,
    ) => BackupSqlRow;
  },
): BackupTable | null {
  const template = input.current ?? input.restored;
  if (!template) return null;
  const rowsByScope = (table: BackupTable | null) => {
    if (!table) return new Map<string, BackupSqlRow>();
    validateBackupTableColumns({
      table,
      tableName: definition.tableName,
      label: definition.label,
      requiredColumns: definition.columns,
    });
    return mapBackupRowsByScope({
      table,
      label: definition.label,
      scopeColumns: [definition.keyColumn],
      validateRow: definition.validateRow,
    });
  };
  const rows = rowsByScope(input.current);
  for (const [key, restored] of rowsByScope(input.restored)) {
    const current = rows.get(key);
    if (!current) {
      rows.set(key, restored);
      continue;
    }
    if (
      definition.immutableColumns.some(
        (column) => current[column] !== restored[column],
      )
    ) {
      throw new Error(
        `Backup conflicts with ${definition.label.toLowerCase()}`,
      );
    }
    rows.set(key, definition.mergeRow?.(current, restored) ?? current);
  }
  return { ...template, rows: [...rows.values()] };
}

export function mergeDocumentPurgeCheckpointBackupTables(
  input: Tables,
): BackupTable | null {
  const label = "Document purge checkpoint";
  return mergeEvidenceTables(input, {
    tableName: DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
    label,
    keyColumn: "document_id",
    columns: [
      "document_id",
      "organization_id",
      "document_manifest_hash",
      "purge_event_hash",
      "updated_at",
    ],
    immutableColumns: [
      "organization_id",
      "document_manifest_hash",
      "purge_event_hash",
    ],
    validateRow: (row) => {
      requireBackupString(row, "document_id", label);
      requireBackupString(row, "organization_id", label);
      requireBackupHash(row, "document_manifest_hash", label);
      requireBackupHash(row, "purge_event_hash", label);
      requireBackupTimestamp(row, "updated_at", label);
    },
  });
}

export async function mergeSecurityIncidentBackupTables(
  input: Tables,
): Promise<BackupTable | null> {
  const label = "Security incident";
  validateRestoredIncidentTimes(input.restored?.rows ?? []);
  const merged = mergeEvidenceTables(input, {
    tableName: SECURITY_INCIDENT_TABLE_NAME,
    label,
    keyColumn: "id",
    columns: [
      "id",
      ...incidentIdentityColumns,
      "detected_at",
      "last_detected_at",
      "occurrence_count",
    ],
    immutableColumns: incidentIdentityColumns,
    validateRow: (row) => {
      for (const column of [
        "id",
        "code",
        "operation",
        "object_kind",
        "evidence_hashes",
      ]) {
        requireBackupString(row, column, label);
      }
      for (const column of ["trust_domain", "object_id", "organization_id"]) {
        if (row[column] !== null) requireBackupString(row, column, label);
      }
      for (const column of ["detected_at", "last_detected_at"]) {
        requireBackupTimestamp(row, column, label);
        const value = requireBackupString(row, column, label);
        if (new Date(value).toISOString() !== value) {
          throw new Error(
            `Security incident backup has a non-canonical ${column}`,
          );
        }
      }
      if (
        String(readProperty(row, "detected_at")) >
        String(readProperty(row, "last_detected_at"))
      ) {
        throw new Error(
          "Security incident backup observation times are reversed",
        );
      }
      requireBackupPositiveInteger(row, "occurrence_count", label);
    },
    mergeRow: (current, restored) => {
      const timestamp = (row: BackupSqlRow, column: string) =>
        Date.parse(requireBackupString(row, column, label));
      return {
        ...current,
        detected_at:
          timestamp(current, "detected_at") <=
          timestamp(restored, "detected_at")
            ? requireBackupString(current, "detected_at", label)
            : requireBackupString(restored, "detected_at", label),
        last_detected_at:
          timestamp(current, "last_detected_at") >=
          timestamp(restored, "last_detected_at")
            ? requireBackupString(current, "last_detected_at", label)
            : requireBackupString(restored, "last_detected_at", label),
        // Backup observations can overlap. Max preserves both lower bounds and
        // makes replaying the same backup idempotent instead of double-counting.
        occurrence_count: Math.max(
          requireBackupPositiveInteger(current, "occurrence_count", label),
          requireBackupPositiveInteger(restored, "occurrence_count", label),
        ),
      };
    },
  });
  if (!merged) return null;
  await Promise.all(merged.rows.map(validateSecurityIncidentBackupIdentity));
  return { ...merged, rows: retainSecurityIncidentBackupRows(merged.rows) };
}
