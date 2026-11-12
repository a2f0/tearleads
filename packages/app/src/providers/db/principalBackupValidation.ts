import type { BackupTable } from "./localBackupPayload";
import { validatePrincipalBackupJson } from "./principalBackupJson";

const PRINCIPAL_IDENTITY_TABLES = new Set([
  "principal_policy_bundles",
  "principal_history_prefixes",
  "principal_history_entries",
  "principal_history_stages",
  "principal_mutation_journal",
  "organization_provisioning_attempts",
]);

function isPrincipalIdentityBackupTable(name: string): boolean {
  return PRINCIPAL_IDENTITY_TABLES.has(name.toLowerCase());
}

function obsoletePrincipalBackup(): never {
  throw new Error(
    "Backup contains obsolete principal identity format and cannot be migrated. Preserve the source database; restoring this format is not supported.",
  );
}

function invalidPrincipalBackup(tableName: string): never {
  throw new Error(
    `Backup contains invalid principal identity data in ${tableName}. Preserve the source database and investigate the damaged data or use an intact backup.`,
  );
}

export function validatePrincipalIdentityBackupTable(
  table: BackupTable,
  declaredColumns: () => readonly string[],
): void {
  if (!isPrincipalIdentityBackupTable(table.name)) return;
  const folded = table.columns.map((column) => column.toLowerCase());
  const metadata = new Set(folded);
  const declaredNames = declaredColumns().map((column) => column.toLowerCase());
  const declared = new Set(declaredNames);
  if (declared.size !== declaredNames.length)
    invalidPrincipalBackup(table.name);
  if (metadata.size !== table.columns.length)
    invalidPrincipalBackup(table.name);
  if (metadata.size !== declared.size) invalidPrincipalBackup(table.name);
  if ([...metadata].some((column) => !declared.has(column)))
    invalidPrincipalBackup(table.name);
  if (!metadata.has("identity_bundle_format")) obsoletePrincipalBackup();
  for (const row of table.rows) {
    const normalized = Object.fromEntries(
      table.columns.map((column) => [
        column.toLowerCase(),
        row[column] ?? null,
      ]),
    );
    const { identity_bundle_format: format } = normalized;
    if (format !== 1) obsoletePrincipalBackup();
    try {
      validatePrincipalBackupJson(table.name.toLowerCase(), normalized);
    } catch {
      invalidPrincipalBackup(table.name);
    }
  }
}
