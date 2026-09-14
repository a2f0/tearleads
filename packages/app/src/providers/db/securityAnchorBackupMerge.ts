import { uniqueBackupTableByName } from "./backupTableValidation";
import {
  ACCESS_MANIFEST_CHECKPOINT_COLUMNS,
  ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  mergeAccessManifestCheckpointBackupTables,
  mergePrincipalPolicyCheckpointBackupTables,
  PRINCIPAL_POLICY_CHECKPOINT_COLUMNS,
  PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
} from "./keyingCheckpointBackupMerge";
import type { BackupIndex, BackupTable } from "./localBackupFormat";
import {
  DOCUMENT_PURGE_CHECKPOINT_COLUMNS,
  DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
  mergeDocumentPurgeCheckpointBackupTables,
  mergeSecurityIncidentBackupTables,
  SECURITY_INCIDENT_COLUMNS,
  SECURITY_INCIDENT_TABLE_NAME,
} from "./terminalSecurityAnchorBackupMerge";
import {
  mergeTrustedIdentityPinBackupTables,
  TRUSTED_IDENTITY_PIN_COLUMNS,
  TRUSTED_IDENTITY_PIN_TABLE_NAME,
} from "./trustedIdentityPinBackupMerge";

/**
 * Anchor columns each merge requires on both sides. These must stay equal to
 * the SDK's SQLite schema for the table (asserted by the neighbouring test);
 * columns added later on either side pass through per `projectBackupRow`.
 */
export const securityAnchorBackupColumns: ReadonlyMap<
  string,
  ReadonlyArray<string>
> = new Map([
  [ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME, ACCESS_MANIFEST_CHECKPOINT_COLUMNS],
  [PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME, PRINCIPAL_POLICY_CHECKPOINT_COLUMNS],
  [TRUSTED_IDENTITY_PIN_TABLE_NAME, TRUSTED_IDENTITY_PIN_COLUMNS],
  [DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME, DOCUMENT_PURGE_CHECKPOINT_COLUMNS],
  [SECURITY_INCIDENT_TABLE_NAME, SECURITY_INCIDENT_COLUMNS],
]);

export function isSecurityAnchorTableName(name: string): boolean {
  return securityAnchorBackupColumns.has(name);
}

/**
 * An anchor table keeps the live schema whenever the live table exists (each
 * merge's `template`), so the live indexes are the ones that fit it: a backup
 * index on that table may name a backup-only column the survivor dropped. A
 * still-lazy anchor table is adopted whole, indexes included.
 */
export function mergeSecurityAnchorBackupIndexes(input: {
  readonly current: ReadonlyArray<BackupIndex>;
  readonly currentTableNames: ReadonlySet<string>;
  readonly restored: ReadonlyArray<BackupIndex>;
}): BackupIndex[] {
  const liveAnchorTable = (index: BackupIndex) =>
    isSecurityAnchorTableName(index.tableName) &&
    input.currentTableNames.has(index.tableName);
  return [
    ...input.restored.filter((index) => !liveAnchorTable(index)),
    ...input.current.filter(liveAnchorTable),
  ];
}

/**
 * Preserve the strongest local trust decision across a full database restore.
 * Missing tables are valid because client security schemas are created lazily.
 */
export async function mergeSecurityAnchorBackupTables(input: {
  readonly current: ReadonlyArray<BackupTable>;
  readonly restored: ReadonlyArray<BackupTable>;
}): Promise<BackupTable[]> {
  const mergedAccessCheckpoints = mergeAccessManifestCheckpointBackupTables({
    current: uniqueBackupTableByName(
      input.current,
      ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
    ),
    restored: uniqueBackupTableByName(
      input.restored,
      ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
    ),
  });
  const mergedPrincipalCheckpoints = mergePrincipalPolicyCheckpointBackupTables(
    {
      current: uniqueBackupTableByName(
        input.current,
        PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
      ),
      restored: uniqueBackupTableByName(
        input.restored,
        PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
      ),
    },
  );
  const mergedIdentityPins = mergeTrustedIdentityPinBackupTables({
    current: uniqueBackupTableByName(
      input.current,
      TRUSTED_IDENTITY_PIN_TABLE_NAME,
    ),
    restored: uniqueBackupTableByName(
      input.restored,
      TRUSTED_IDENTITY_PIN_TABLE_NAME,
    ),
  });

  const mergedPurgeCheckpoints = mergeDocumentPurgeCheckpointBackupTables({
    current: uniqueBackupTableByName(
      input.current,
      DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
    ),
    restored: uniqueBackupTableByName(
      input.restored,
      DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
    ),
  });
  const mergedIncidents = await mergeSecurityIncidentBackupTables({
    current: uniqueBackupTableByName(
      input.current,
      SECURITY_INCIDENT_TABLE_NAME,
    ),
    restored: uniqueBackupTableByName(
      input.restored,
      SECURITY_INCIDENT_TABLE_NAME,
    ),
  });

  return [
    ...input.restored.filter((table) => !isSecurityAnchorTableName(table.name)),
    ...(mergedAccessCheckpoints ? [mergedAccessCheckpoints] : []),
    ...(mergedPrincipalCheckpoints ? [mergedPrincipalCheckpoints] : []),
    ...(mergedIdentityPins ? [mergedIdentityPins] : []),
    ...(mergedPurgeCheckpoints ? [mergedPurgeCheckpoints] : []),
    ...(mergedIncidents ? [mergedIncidents] : []),
  ];
}
