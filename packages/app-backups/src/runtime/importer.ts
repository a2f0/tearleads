/**
 * Backup Importer Utilities
 *
 * Format-level validation and info extraction for .tbu backup files.
 * These functions operate on the backup format without requiring
 * client-specific infrastructure (database setup, instance registry, etc.).
 */

import { type BackupManifest, validateBackup } from '../format/index';

/**
 * Generate an instance name from the backup date.
 * Format: "Backup (Feb 2, 2026)"
 */
function generateInstanceName(manifest: BackupManifest): string {
  const date = new Date(manifest.createdAt);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `Backup (${month} ${day}, ${year})`;
}

/**
 * Validate a backup file before restoring.
 * Returns the manifest if valid, or an error message.
 */
export async function validateBackupFile(
  data: Uint8Array,
  password: string
): Promise<
  { valid: true; manifest: BackupManifest } | { valid: false; error: string }
> {
  const result = await validateBackup(data, password);

  if (!result.valid) {
    return { valid: false, error: result.error ?? 'Unknown error' };
  }

  if (!result.manifest) {
    return { valid: false, error: 'Backup is missing manifest' };
  }

  return { valid: true, manifest: result.manifest };
}

/**
 * Get information about a backup file without fully decoding it.
 */
export async function getBackupInfo(
  data: Uint8Array,
  password: string
): Promise<{
  manifest: BackupManifest;
  suggestedName: string;
} | null> {
  const validation = await validateBackupFile(data, password);

  if (!validation.valid) {
    return null;
  }

  return {
    manifest: validation.manifest,
    suggestedName: generateInstanceName(validation.manifest)
  };
}
