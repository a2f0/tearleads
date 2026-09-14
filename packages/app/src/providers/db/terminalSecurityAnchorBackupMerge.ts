import type { SecurityIncidents } from "@tearleads/client-sdk";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  mapBackupRowsByScope,
  projectBackupRow,
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
  readIncidentText,
  retainSecurityIncidentBackupRows,
  validateRestoredIncidentTimes,
  validateSecurityIncidentBackupIdentity,
} from "./securityIncidentBackupValidation";

export const DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME =
  "document_purge_checkpoints";
export const SECURITY_INCIDENT_TABLE_NAME = "security_incidents";
export const DOCUMENT_PURGE_CHECKPOINT_COLUMNS: ReadonlyArray<string> = [
  "document_id",
  "organization_id",
  "document_manifest_hash",
  "purge_event_hash",
  "updated_at",
];
export const SECURITY_INCIDENT_COLUMNS: ReadonlyArray<string> = [
  "id",
  ...incidentIdentityColumns,
  "detected_at",
  "last_detected_at",
  "occurrence_count",
];

const PURGE_CONFLICT_LABEL = "Document purge checkpoint";

type SecurityIncidentContext = Parameters<SecurityIncidents["record"]>[1];

/**
 * An honest API issues one signed purge proof per document, so a backup whose
 * pin for a document differs from the one this device verified is worth a
 * hard stop and an incident. The backup rows are only shape-checked, though,
 * so an edited backup file could manufacture the disagreement; it is recorded
 * as an object mismatch between the two records, not as server equivocation.
 * The caller records `incident` in the live ledger before surfacing this.
 */
export class DocumentPurgeCheckpointConflictError extends KeyingVerificationError {
  readonly documentId: string;
  readonly incident: SecurityIncidentContext;

  constructor(current: BackupSqlRow, restored: BackupSqlRow) {
    super(
      "object_mismatch",
      "Backup disagrees with the local document purge checkpoint",
    );
    this.name = "DocumentPurgeCheckpointConflictError";
    const hash = (row: BackupSqlRow, column: string) =>
      requireBackupHash(row, column, PURGE_CONFLICT_LABEL);
    this.documentId = requireBackupString(
      current,
      "document_id",
      PURGE_CONFLICT_LABEL,
    );
    this.incident = {
      evidenceHashes: {
        current_document_manifest_hash: hash(current, "document_manifest_hash"),
        current_purge_event_hash: hash(current, "purge_event_hash"),
        restored_document_manifest_hash: hash(
          restored,
          "document_manifest_hash",
        ),
        restored_purge_event_hash: hash(restored, "purge_event_hash"),
      },
      objectId: this.documentId,
      objectKind: "document",
      operation: "backup.restore",
      organizationId: requireBackupString(
        current,
        "organization_id",
        PURGE_CONFLICT_LABEL,
      ),
    };
  }
}

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
    readonly conflict: (current: BackupSqlRow, restored: BackupSqlRow) => Error;
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
  const project = (row: BackupSqlRow, fallback?: BackupSqlRow) =>
    projectBackupRow({ columns: template.columns, fallback, row });
  const rows = rowsByScope(input.current);
  for (const [key, restored] of rowsByScope(input.restored)) {
    const current = rows.get(key);
    if (!current) {
      rows.set(key, project(restored));
      continue;
    }
    if (
      definition.immutableColumns.some(
        (column) => current[column] !== restored[column],
      )
    ) {
      throw definition.conflict(current, restored);
    }
    const merged = definition.mergeRow?.(current, restored);
    rows.set(key, merged ? project(merged, restored) : current);
  }
  return { ...template, rows: [...rows.values()] };
}

export function mergeDocumentPurgeCheckpointBackupTables(
  input: Tables,
): BackupTable | null {
  const label = PURGE_CONFLICT_LABEL;
  return mergeEvidenceTables(input, {
    tableName: DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
    label,
    keyColumn: "document_id",
    columns: DOCUMENT_PURGE_CHECKPOINT_COLUMNS,
    immutableColumns: [
      "organization_id",
      "document_manifest_hash",
      "purge_event_hash",
    ],
    conflict: (current, restored) =>
      new DocumentPurgeCheckpointConflictError(current, restored),
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
    columns: SECURITY_INCIDENT_COLUMNS,
    immutableColumns: incidentIdentityColumns,
    // A colliding incident id with different evidence is a forged backup, not
    // server equivocation, so it stays a plain refusal.
    conflict: () => new Error("Backup conflicts with security incident"),
    validateRow: (row) => {
      for (const column of ["id", "code", "object_kind", "evidence_hashes"]) {
        requireBackupString(row, column, label);
      }
      readIncidentText(row, "operation");
      for (const column of ["trust_domain", "object_id", "organization_id"]) {
        if (row[column] !== null) readIncidentText(row, column);
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
  return {
    ...merged,
    rows: retainSecurityIncidentBackupRows(
      merged.rows,
      new Set(
        (input.current?.rows ?? []).map((row) =>
          requireBackupString(row, "id", label),
        ),
      ),
    ),
  };
}
