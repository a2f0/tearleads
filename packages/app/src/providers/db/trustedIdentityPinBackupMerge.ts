import {
  mapBackupRowsByScope,
  requireBackupHash,
  requireBackupPositiveInteger,
  requireBackupString,
  requireBackupTimestamp,
  validateBackupTableColumns,
} from "./backupTableValidation";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";

export const TRUSTED_IDENTITY_PIN_TABLE_NAME = "trusted_user_identity_pins";

const scopeColumns = ["identity_trust_domain", "user_id"] as const;
const immutableColumns = [
  "format_version",
  "signing_suite",
  "signing_public_key",
  "signing_key_fingerprint",
  "encapsulation_suite",
  "encapsulation_public_key",
  "encapsulation_key_fingerprint",
] as const;
const requiredColumns = [
  ...scopeColumns,
  ...immutableColumns,
  "first_seen_at",
] as const;

function validateRow(row: BackupSqlRow): void {
  for (const column of scopeColumns) {
    requireBackupString(row, column, "Trusted identity pin");
  }
  if (
    requireBackupPositiveInteger(
      row,
      "format_version",
      "Trusted identity pin",
    ) !== 1
  ) {
    throw new Error(
      "Trusted identity pin backup has an unsupported format_version value",
    );
  }
  if (
    requireBackupString(row, "signing_suite", "Trusted identity pin") !==
    "ML-DSA-87"
  ) {
    throw new Error(
      "Trusted identity pin backup has an unsupported signing_suite value",
    );
  }
  if (
    requireBackupString(row, "encapsulation_suite", "Trusted identity pin") !==
    "ML-KEM-1024"
  ) {
    throw new Error(
      "Trusted identity pin backup has an unsupported encapsulation_suite value",
    );
  }
  requireBackupString(row, "signing_public_key", "Trusted identity pin");
  requireBackupHash(row, "signing_key_fingerprint", "Trusted identity pin");
  requireBackupString(row, "encapsulation_public_key", "Trusted identity pin");
  requireBackupHash(
    row,
    "encapsulation_key_fingerprint",
    "Trusted identity pin",
  );
  requireBackupTimestamp(row, "first_seen_at", "Trusted identity pin");
}

function validateTable(table: BackupTable): void {
  validateBackupTableColumns({
    label: "Trusted identity pin",
    requiredColumns,
    table,
    tableName: TRUSTED_IDENTITY_PIN_TABLE_NAME,
  });
}

function assertSameIdentity(
  current: BackupSqlRow,
  restored: BackupSqlRow,
): void {
  const changed = immutableColumns.filter(
    (column) => current[column] !== restored[column],
  );
  if (changed.length > 0) {
    throw new Error(
      `Backup conflicts with a trusted identity pin (${changed.join(", ")})`,
    );
  }
}

/** Merge backup pins without resetting an existing TOFU decision. */
export function mergeTrustedIdentityPinBackupTables(input: {
  readonly current: BackupTable | null;
  readonly restored: BackupTable | null;
}): BackupTable | null {
  if (!input.current && !input.restored) {
    return null;
  }
  if (input.current) {
    validateTable(input.current);
  }
  if (input.restored) {
    validateTable(input.restored);
  }
  const template = input.current ?? input.restored;
  if (!template) {
    return null;
  }
  const currentRows = input.current
    ? mapBackupRowsByScope({
        label: "Trusted identity pin",
        scopeColumns,
        table: input.current,
        validateRow,
      })
    : new Map<string, BackupSqlRow>();
  const restoredRows = input.restored
    ? mapBackupRowsByScope({
        label: "Trusted identity pin",
        scopeColumns,
        table: input.restored,
        validateRow,
      })
    : new Map<string, BackupSqlRow>();

  for (const [key, restored] of restoredRows) {
    const current = currentRows.get(key);
    if (current) {
      assertSameIdentity(current, restored);
    } else {
      currentRows.set(key, restored);
    }
  }
  return { ...template, rows: [...currentRows.values()] };
}
