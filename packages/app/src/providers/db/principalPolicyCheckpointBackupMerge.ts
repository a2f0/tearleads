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

export const PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME =
  "principal_policy_checkpoints";
const scopeColumns = ["principal_type", "principal_id"] as const;
export const PRINCIPAL_POLICY_CHECKPOINT_COLUMNS: ReadonlyArray<string> = [
  ...scopeColumns,
  "organization_id",
  "version",
  "state_hash",
  "updated_at",
];
const label = "Principal policy checkpoint";
const pinColumns = ["version", "state_hash", "updated_at"] as const;

/** The row's pin version, or null when it records ownership alone. */
function readPinVersion(row: BackupSqlRow): number | null {
  if (pinColumns.every((column) => row[column] === null)) return null;
  const version = requireBackupPositiveInteger(row, "version", label);
  requireBackupHash(row, "state_hash", label);
  requireBackupTimestamp(row, "updated_at", label);
  return version;
}

function validateRow(row: BackupSqlRow): void {
  const type = requireBackupString(row, "principal_type", label);
  const id = requireBackupString(row, "principal_id", label);
  const owner = requireBackupString(row, "organization_id", label);
  if (type !== "group" && type !== "organization")
    throw new Error(
      "Principal policy checkpoint backup has an invalid principal_type value",
    );
  if (type === "organization" && id !== owner)
    throw new Error(
      "Principal policy checkpoint backup conflicts with organization identity",
    );
  readPinVersion(row);
}

/**
 * The surviving row for one principal: its owner is immutable, so a backup
 * naming another organization refuses the restore; its pin is monotone, so
 * the higher version wins, an unpinned side never clears the other's pin, and
 * a different hash at the same version is forked evidence.
 */
function mergeRow(
  current: BackupSqlRow,
  restored: BackupSqlRow,
  project: (row: BackupSqlRow, fallback?: BackupSqlRow) => BackupSqlRow,
): BackupSqlRow {
  if (
    requireBackupString(current, "organization_id", label) !==
    requireBackupString(restored, "organization_id", label)
  )
    throw new Error(
      "Backup conflicts with principal policy organization ownership",
    );
  const currentVersion = readPinVersion(current);
  const restoredVersion = readPinVersion(restored);
  if (restoredVersion === null) return current;
  if (currentVersion === null || restoredVersion > currentVersion)
    return project(restored, current);
  if (
    restoredVersion === currentVersion &&
    requireBackupHash(current, "state_hash", label) !==
      requireBackupHash(restored, "state_hash", label)
  )
    throw new Error("Backup conflicts with a principal policy checkpoint");
  return current;
}

/** Ownership and the anti-rollback pin survive a restore together. */
export function mergePrincipalPolicyCheckpointBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  const template = input.current ?? input.restored;
  if (!template) return null;
  const readRows = (table: BackupTable | null) => {
    if (!table) return new Map<string, BackupSqlRow>();
    validateBackupTableColumns({
      label,
      requiredColumns: PRINCIPAL_POLICY_CHECKPOINT_COLUMNS,
      table,
      tableName: PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
    });
    return mapBackupRowsByScope({ label, scopeColumns, table, validateRow });
  };
  const project = (row: BackupSqlRow, fallback?: BackupSqlRow) =>
    projectBackupRow({ columns: template.columns, fallback, row });
  const rows = readRows(input.current);
  for (const [key, restored] of readRows(input.restored)) {
    const current = rows.get(key);
    rows.set(
      key,
      current ? mergeRow(current, restored, project) : project(restored),
    );
  }
  return { ...template, rows: [...rows.values()] };
}
