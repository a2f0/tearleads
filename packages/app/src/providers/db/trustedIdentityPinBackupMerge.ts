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

function requireRowValue(
  row: BackupSqlRow,
  column: (typeof requiredColumns)[number],
): string | number {
  const value = row[column];
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    value === ""
  ) {
    throw new Error(
      `Trusted identity pin backup has an invalid ${column} value`,
    );
  }
  return value;
}

function validateTable(table: BackupTable): void {
  if (table.name !== TRUSTED_IDENTITY_PIN_TABLE_NAME) {
    throw new Error("Trusted identity pin backup table name is invalid");
  }
  const columns = new Set(table.columns);
  for (const column of requiredColumns) {
    if (!columns.has(column)) {
      throw new Error(
        `Trusted identity pin backup is missing the ${column} column`,
      );
    }
  }
  for (const row of table.rows) {
    for (const column of requiredColumns) {
      requireRowValue(row, column);
    }
  }
}

function scopeKey(row: BackupSqlRow): string {
  return scopeColumns.map((column) => requireRowValue(row, column)).join("\0");
}

function assertSameIdentity(
  current: BackupSqlRow,
  restored: BackupSqlRow,
): void {
  const changed = immutableColumns.filter(
    (column) =>
      requireRowValue(current, column) !== requireRowValue(restored, column),
  );
  if (changed.length > 0) {
    throw new Error(
      `Backup conflicts with a trusted identity pin (${changed.join(", ")})`,
    );
  }
}

/**
 * Merge an imported backup into the current monotonic trust store. Current
 * observations win on exact overlap (including their original first-seen
 * timestamp), backup-only identities are retained, and any identity change
 * aborts the surrounding restore transaction.
 */
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
  const rowsByScope = new Map<string, BackupSqlRow>();
  for (const row of input.current?.rows ?? []) {
    rowsByScope.set(scopeKey(row), row);
  }
  for (const row of input.restored?.rows ?? []) {
    const key = scopeKey(row);
    const current = rowsByScope.get(key);
    if (current) {
      assertSameIdentity(current, row);
    } else {
      rowsByScope.set(key, row);
    }
  }

  return { ...template, rows: [...rowsByScope.values()] };
}
