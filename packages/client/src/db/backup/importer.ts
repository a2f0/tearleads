/**
 * Backup Importer Service
 *
 * Restores .tbu backup files by:
 * 1. Creating a new database instance
 * 2. Restoring database data
 * 3. Restoring file blobs
 */

import { initializeFileStorage } from '@/storage/opfs';
import type { DatabaseAdapter } from '../adapters/types';
import { getKeyManagerForInstance } from '../crypto';
import { closeDatabase, getDatabaseAdapter, setupDatabase } from '../index';
import {
  createInstance,
  type InstanceMetadata,
  updateInstance
} from '../instanceRegistry';
import { type DecodeResult, decode, validateBackup } from './decoder';
import type {
  BackupManifest,
  BackupProgressEvent,
  ImportResult
} from './types';

/**
 * Tables to skip during import.
 * - schema_migrations: Already populated by setupDatabase() migrations.
 *   Importing would cause PRIMARY KEY conflicts.
 */
const IMPORT_SKIP_TABLES = new Set(['schema_migrations']);

/**
 * Options for restoring a backup.
 */
interface RestoreBackupOptions {
  /** The backup file data */
  backupData: Uint8Array;
  /** Password used to encrypt the backup */
  backupPassword: string;
  /** Password for the new instance */
  newInstancePassword: string;
  /** Progress callback */
  onProgress?: (event: BackupProgressEvent) => void;
}

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
 * Restore data to a table.
 */
const SQLITE_MAX_BIND_PARAMETERS = 999;

function normalizeRestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return value;
}

async function restoreTableData(
  adapter: DatabaseAdapter,
  tableName: string,
  rows: unknown[]
): Promise<void> {
  if (rows.length === 0) return;

  // Get column names from the first row
  const firstRow = rows[0] as Record<string, unknown>;
  const columns = Object.keys(firstRow);

  if (columns.length === 0) return;

  // Build INSERT statement
  const placeholders = columns.map(() => '?').join(', ');
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  const singleRowSql = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`;
  const maxRowsPerBatch = Math.max(
    1,
    Math.floor(SQLITE_MAX_BIND_PARAMETERS / columns.length)
  );

  for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
    const batchRows = rows.slice(i, i + maxRowsPerBatch);
    if (batchRows.length === 0) {
      continue;
    }

    const batchSql = `INSERT INTO "${tableName}" (${columnList}) VALUES ${batchRows
      .map(() => `(${placeholders})`)
      .join(', ')}`;
    const batchValues = batchRows.flatMap((rawRow) => {
      const rowData = rawRow as Record<string, unknown>;
      return columns.map((columnName) =>
        normalizeRestoreValue(rowData[columnName])
      );
    });

    try {
      await adapter.execute(batchSql, batchValues);
      continue;
    } catch {
      // Fallback preserves previous best-effort semantics if a batch fails.
    }

    for (const rawRow of batchRows) {
      const rowData = rawRow as Record<string, unknown>;
      const values = columns.map((columnName) =>
        normalizeRestoreValue(rowData[columnName])
      );

      try {
        await adapter.execute(singleRowSql, values);
      } catch (err) {
        // Log but continue - some rows may conflict with existing data
        console.warn(`Failed to insert row into ${tableName}:`, err);
      }
    }
  }
}

export const __test__ = {
  restoreTableData
};

/**
 * Restore a backup to a new instance.
 *
 * @param options - Restore options
 * @returns Information about the restored instance
 */
export async function restoreBackup(
  options: RestoreBackupOptions
): Promise<ImportResult> {
  const { backupData, backupPassword, newInstancePassword, onProgress } =
    options;

  // Phase 1: Decode the backup
  onProgress?.({
    phase: 'preparing',
    current: 0,
    total: 4,
    currentItem: 'Decoding backup'
  });

  let decoded: DecodeResult;
  try {
    decoded = await decode({
      data: backupData,
      password: backupPassword,
      ...(onProgress && { onProgress })
    });
  } catch (err) {
    throw new Error(
      `Failed to decode backup: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }

  const { manifest, database, blobs } = decoded;

  // Phase 2: Create new instance
  onProgress?.({
    phase: 'preparing',
    current: 1,
    total: 4,
    currentItem: 'Creating new instance'
  });

  const instanceName = generateInstanceName(manifest);
  const instance = await createInstance();

  // Update instance name
  await updateInstance(instance.id, { name: instanceName });
  const updatedInstance: InstanceMetadata = { ...instance, name: instanceName };

  // Phase 3: Set up database and restore data
  onProgress?.({
    phase: 'database',
    current: 2,
    total: 4,
    currentItem: 'Setting up database'
  });

  try {
    // Set up the new database with the user's password
    await setupDatabase(newInstancePassword, instance.id);

    const adapter = getDatabaseAdapter();

    // Disable FK checks during import to avoid constraint violations from table ordering
    await adapter.execute('PRAGMA foreign_keys = OFF');

    try {
      // Restore data to each table, skipping internal tables
      const tables = Object.keys(database.data).filter(
        (t) => !IMPORT_SKIP_TABLES.has(t)
      );

      for (const [i, tableName] of tables.entries()) {
        if (!tableName) continue;

        const rows = database.data[tableName];

        onProgress?.({
          phase: 'database',
          current: i,
          total: tables.length,
          currentItem: `Restoring ${tableName}`
        });

        if (Array.isArray(rows) && rows.length > 0) {
          await restoreTableData(adapter, tableName, rows);
        }
      }
    } finally {
      // Re-enable FK checks
      await adapter.execute('PRAGMA foreign_keys = ON');
    }

    // Phase 4: Restore blobs
    if (blobs.length > 0) {
      onProgress?.({
        phase: 'blobs',
        current: 0,
        total: blobs.length,
        currentItem: 'Initializing file storage'
      });

      // Get the encryption key for file storage
      const keyManager = getKeyManagerForInstance(instance.id);
      const encryptionKey = keyManager.getCurrentKey();

      if (!encryptionKey) {
        throw new Error('Encryption key not available for file storage');
      }

      const fileStorage = await initializeFileStorage(
        encryptionKey,
        instance.id
      );

      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        if (!blob) continue;

        onProgress?.({
          phase: 'blobs',
          current: i + 1,
          total: blobs.length,
          currentItem: blob.header.path
        });

        // Store the blob using the file storage
        // The storage path is the filename without directory
        const filename = blob.header.path.replace('.enc', '');
        await fileStorage.store(filename, blob.data);
      }
    }

    onProgress?.({
      phase: 'finalizing',
      current: 4,
      total: 4,
      currentItem: 'Finalizing'
    });

    // Close the database (user will need to unlock it)
    await closeDatabase();

    return {
      instanceId: instance.id,
      instanceName: updatedInstance.name,
      manifest
    };
  } catch (err) {
    // Clean up on failure
    try {
      await closeDatabase();
      // Note: We don't delete the instance here as it might have partial data
      // The user can delete it manually if needed
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
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
