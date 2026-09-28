import {
  mapBackupRowsByScope,
  projectBackupRow,
  requireBackupString,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export const PRINCIPAL_POLICY_OWNER_TABLE_NAME =
  "principal_policy_organizations";
const scopeColumns = ["principal_type", "principal_id"] as const;
export const PRINCIPAL_POLICY_OWNER_COLUMNS: ReadonlyArray<string> = [
  ...scopeColumns,
  "organization_id",
];
const label = "Principal policy owner";

function validateRow(row: BackupSqlRow): void {
  const type = requireBackupString(row, "principal_type", label);
  const id = requireBackupString(row, "principal_id", label);
  const owner = requireBackupString(row, "organization_id", label);
  if (type !== "group" && type !== "organization")
    throw new Error(
      "Principal policy owner backup has an invalid principal_type value",
    );
  if (type === "organization" && id !== owner)
    throw new Error(
      "Principal policy owner backup conflicts with organization identity",
    );
}

/** An immutable owner must survive whenever its policy checkpoint survives. */
export function mergePrincipalPolicyOwnerBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  const template = input.current ?? input.restored;
  if (!template) return null;
  const readRows = (table: BackupTable | null) => {
    if (!table) return new Map<string, BackupSqlRow>();
    validateBackupTableColumns({
      label,
      requiredColumns: PRINCIPAL_POLICY_OWNER_COLUMNS,
      table,
      tableName: PRINCIPAL_POLICY_OWNER_TABLE_NAME,
    });
    return mapBackupRowsByScope({ label, scopeColumns, table, validateRow });
  };
  const rows = readRows(input.current);
  for (const [key, restored] of readRows(input.restored)) {
    const current = rows.get(key);
    if (
      current &&
      requireBackupString(current, "organization_id", label) !==
        requireBackupString(restored, "organization_id", label)
    )
      throw new Error(
        "Backup conflicts with principal policy organization ownership",
      );
    if (!current)
      rows.set(
        key,
        projectBackupRow({ columns: template.columns, row: restored }),
      );
  }
  return { ...template, rows: [...rows.values()] };
}
