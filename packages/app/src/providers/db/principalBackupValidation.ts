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

export function isPrincipalIdentityBackupTable(name: string): boolean {
  return PRINCIPAL_IDENTITY_TABLES.has(name.toLowerCase());
}

export function obsoletePrincipalBackup(): never {
  throw new Error(
    "Backup contains obsolete principal identity format; reset the source local database before creating a new backup.",
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
  if (declared.size !== declaredNames.length) obsoletePrincipalBackup();
  if (metadata.size !== table.columns.length) obsoletePrincipalBackup();
  if (metadata.size !== declared.size) obsoletePrincipalBackup();
  if ([...metadata].some((column) => !declared.has(column)))
    obsoletePrincipalBackup();
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
      obsoletePrincipalBackup();
    }
  }
}
