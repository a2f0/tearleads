import {
  mapBackupRowsByScope,
  projectBackupRow,
  requireBackupHash,
  requireBackupString,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export const PRINCIPAL_GRANT_RETIREMENT_TABLE_NAME =
  "principal_grant_retirements";
export const PRINCIPAL_GRANT_RETIREMENT_COLUMNS: readonly string[] = [
  "organization_id",
  "container_id",
  "principal_id",
  "policy_state_hash",
];

/** A restore cannot undo an acknowledged expectation that a grant is retired. */
export function mergePrincipalGrantRetirementBackupTables(input: {
  current: BackupTable | null;
  restored: BackupTable | null;
}): BackupTable | null {
  const template = input.current ?? input.restored;
  if (!template) return null;
  const label = "Principal grant retirement";
  const rowsByScope = (table: BackupTable | null) => {
    if (!table) return new Map<string, BackupSqlRow>();
    validateBackupTableColumns({
      table,
      label,
      tableName: PRINCIPAL_GRANT_RETIREMENT_TABLE_NAME,
      requiredColumns: PRINCIPAL_GRANT_RETIREMENT_COLUMNS,
    });
    return mapBackupRowsByScope({
      table,
      label,
      scopeColumns: ["organization_id", "container_id"],
      validateRow(row) {
        for (const column of [
          "organization_id",
          "container_id",
          "principal_id",
        ])
          requireBackupString(row, column, label);
        requireBackupHash(row, "policy_state_hash", label);
      },
    });
  };
  const rows = rowsByScope(input.current);
  for (const [scope, restored] of rowsByScope(input.restored)) {
    const current = rows.get(scope);
    // Either acknowledgement establishes the same terminal expectation. Keep
    // the first local observation, matching the SDK's on-conflict insertion.
    if (!current)
      rows.set(
        scope,
        projectBackupRow({ columns: template.columns, row: restored }),
      );
  }
  return { ...template, rows: [...rows.values()] };
}
