import {
  mapBackupRowsByScope,
  projectBackupRow,
  requireBackupString,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export const ORGANIZATION_FOUNDER_TABLE_NAME = "organization_founders";
export const ORGANIZATION_FOUNDER_COLUMNS = [
  "organization_id",
  "user_id",
  "signing_key_fingerprint",
  "genesis_state_hash",
] as const;
const label = "Organization founder";

/** Restore may add a founder binding, never erase or replace an observed one. */
export function mergeOrganizationFounderBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  const template = input.current ?? input.restored;
  if (!template) return null;
  const readRows = (table: BackupTable | null) => {
    if (!table) return new Map<string, BackupSqlRow>();
    validateBackupTableColumns({
      label,
      requiredColumns: ORGANIZATION_FOUNDER_COLUMNS,
      table,
      tableName: ORGANIZATION_FOUNDER_TABLE_NAME,
    });
    return mapBackupRowsByScope({
      label,
      scopeColumns: ["organization_id"],
      table,
      validateRow: (row) => {
        for (const column of ORGANIZATION_FOUNDER_COLUMNS)
          requireBackupString(row, column, label);
      },
    });
  };
  const rows = readRows(input.current);
  for (const [key, restored] of readRows(input.restored)) {
    const current = rows.get(key);
    if (
      current &&
      ORGANIZATION_FOUNDER_COLUMNS.some(
        (column) =>
          requireBackupString(current, column, label) !==
          requireBackupString(restored, column, label),
      )
    )
      throw new Error("Backup conflicts with an organization's pinned founder");
    if (!current)
      rows.set(
        key,
        projectBackupRow({ columns: template.columns, row: restored }),
      );
  }
  return { ...template, rows: [...rows.values()] };
}
