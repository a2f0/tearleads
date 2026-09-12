import { uniqueBackupTableByName } from "./backupTableValidation";
import {
  ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  mergeAccessManifestCheckpointBackupTables,
  mergePrincipalPolicyCheckpointBackupTables,
  PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
} from "./keyingCheckpointBackupMerge";
import type { BackupTable } from "./localBackupFormat";
import {
  DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
  mergeDocumentPurgeCheckpointBackupTables,
  mergeSecurityIncidentBackupTables,
  SECURITY_INCIDENT_TABLE_NAME,
} from "./terminalSecurityAnchorBackupMerge";
import {
  mergeTrustedIdentityPinBackupTables,
  TRUSTED_IDENTITY_PIN_TABLE_NAME,
} from "./trustedIdentityPinBackupMerge";

const securityAnchorTableNames = new Set([
  ACCESS_MANIFEST_CHECKPOINT_TABLE_NAME,
  PRINCIPAL_POLICY_CHECKPOINT_TABLE_NAME,
  TRUSTED_IDENTITY_PIN_TABLE_NAME,
  DOCUMENT_PURGE_CHECKPOINT_TABLE_NAME,
  SECURITY_INCIDENT_TABLE_NAME,
]);

export function isSecurityAnchorTableName(name: string): boolean {
  return securityAnchorTableNames.has(name);
}

/**
 * Preserve the strongest local trust decision across a full database restore.
 * Missing tables are valid because client security schemas are created lazily.
 */
export function mergeSecurityAnchorBackupTables(input: {
  readonly current: ReadonlyArray<BackupTable>;
  readonly restored: ReadonlyArray<BackupTable>;
}): BackupTable[] {
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
  const mergedIncidents = mergeSecurityIncidentBackupTables({
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
