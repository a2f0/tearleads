import {
  mapBackupRowsByScope,
  requireBackupHash,
  requireBackupPositiveInteger,
  requireBackupString,
  requireBackupTimestamp,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export const ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME =
  "access_manifest_checkpoints";
export const PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME =
  "principal_policy_checkpoints";

interface MonotonicCheckpointDefinition {
  readonly conflictMessage: string;
  readonly hashColumn: string;
  readonly label: string;
  readonly positionColumn: string;
  readonly requiredColumns: ReadonlyArray<string>;
  readonly scopeColumns: ReadonlyArray<string>;
  readonly tableName: string;
  readonly validateScope: (row: BackupSqlRow) => void;
}

function validateTable(
  table: BackupTable,
  definition: MonotonicCheckpointDefinition,
): void {
  validateBackupTableColumns({
    label: definition.label,
    requiredColumns: definition.requiredColumns,
    table,
    tableName: definition.tableName,
  });
}

function validateRow(
  row: BackupSqlRow,
  definition: MonotonicCheckpointDefinition,
): void {
  definition.validateScope(row);
  requireBackupPositiveInteger(
    row,
    definition.positionColumn,
    definition.label,
  );
  requireBackupHash(row, definition.hashColumn, definition.label);
  requireBackupTimestamp(row, "updated_at", definition.label);
}

function mergeCheckpointTables(
  input: {
    readonly current: BackupTable | null;
    readonly restored: BackupTable | null;
  },
  definition: MonotonicCheckpointDefinition,
): BackupTable | null {
  if (!input.current && !input.restored) {
    return null;
  }
  if (input.current) {
    validateTable(input.current, definition);
  }
  if (input.restored) {
    validateTable(input.restored, definition);
  }
  const template = input.current ?? input.restored;
  if (!template) {
    return null;
  }
  const validateCheckpointRow = (row: BackupSqlRow) =>
    validateRow(row, definition);
  const mergedRows = input.current
    ? mapBackupRowsByScope({
        label: definition.label,
        scopeColumns: definition.scopeColumns,
        table: input.current,
        validateRow: validateCheckpointRow,
      })
    : new Map<string, BackupSqlRow>();
  const restoredRows = input.restored
    ? mapBackupRowsByScope({
        label: definition.label,
        scopeColumns: definition.scopeColumns,
        table: input.restored,
        validateRow: validateCheckpointRow,
      })
    : new Map<string, BackupSqlRow>();

  for (const [key, restored] of restoredRows) {
    const current = mergedRows.get(key);
    if (!current) {
      mergedRows.set(key, restored);
      continue;
    }
    const currentPosition = requireBackupPositiveInteger(
      current,
      definition.positionColumn,
      definition.label,
    );
    const restoredPosition = requireBackupPositiveInteger(
      restored,
      definition.positionColumn,
      definition.label,
    );
    if (restoredPosition > currentPosition) {
      mergedRows.set(key, restored);
      continue;
    }
    if (
      restoredPosition === currentPosition &&
      requireBackupHash(current, definition.hashColumn, definition.label) !==
        requireBackupHash(restored, definition.hashColumn, definition.label)
    ) {
      throw new Error(definition.conflictMessage);
    }
  }
  return { ...template, rows: [...mergedRows.values()] };
}

const accessCheckpointDefinition: MonotonicCheckpointDefinition = {
  conflictMessage: "Backup conflicts with an access manifest checkpoint",
  hashColumn: "manifest_hash",
  label: "Access manifest checkpoint",
  positionColumn: "epoch",
  requiredColumns: [
    "object_kind",
    "organization_id",
    "object_id",
    "epoch",
    "manifest_hash",
    "updated_at",
  ],
  scopeColumns: ["object_kind", "organization_id", "object_id"],
  tableName: ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  validateScope: (row) => {
    const objectKind = requireBackupString(
      row,
      "object_kind",
      "Access manifest checkpoint",
    );
    if (
      objectKind !== "blob" &&
      objectKind !== "container" &&
      objectKind !== "document"
    ) {
      throw new Error(
        "Access manifest checkpoint backup has an invalid object_kind value",
      );
    }
    requireBackupString(row, "organization_id", "Access manifest checkpoint");
    requireBackupString(row, "object_id", "Access manifest checkpoint");
  },
};

const principalCheckpointDefinition: MonotonicCheckpointDefinition = {
  conflictMessage: "Backup conflicts with a principal policy checkpoint",
  hashColumn: "state_hash",
  label: "Principal policy checkpoint",
  positionColumn: "version",
  requiredColumns: [
    "principal_type",
    "principal_id",
    "version",
    "state_hash",
    "updated_at",
  ],
  scopeColumns: ["principal_type", "principal_id"],
  tableName: PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
  validateScope: (row) => {
    const principalType = requireBackupString(
      row,
      "principal_type",
      "Principal policy checkpoint",
    );
    if (principalType !== "group" && principalType !== "organization") {
      throw new Error(
        "Principal policy checkpoint backup has an invalid principal_type value",
      );
    }
    requireBackupString(row, "principal_id", "Principal policy checkpoint");
  },
};

export function mergeAccessManifestCheckpointBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  return mergeCheckpointTables(input, accessCheckpointDefinition);
}

export function mergePrincipalPolicyCheckpointBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  return mergeCheckpointTables(input, principalCheckpointDefinition);
}
