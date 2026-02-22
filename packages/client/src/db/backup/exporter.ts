/**
 * Backup Exporter Service
 *
 * Orchestrates the creation of .tbu backup files by:
 * 1. Extracting database schemas and data
 * 2. Collecting file blobs from storage
 * 3. Encoding everything into the backup format
 */

import type { FileStorage } from '@/storage/opfs';
import type { DatabaseAdapter } from '../adapters/types';
import { FORMAT_VERSION } from './constants';
import { type EncodeOptions, encode } from './encoder';
import type {
  BackupDatabase,
  BackupManifest,
  BackupProgressEvent,
  BlobEntry,
  IndexSchema,
  TableSchema
} from './types';

/**
 * Options for creating a backup.
 */
interface CreateBackupOptions {
  /** Password for encrypting the backup */
  password: string;
  /** Include file blobs in the backup */
  includeBlobs: boolean;
  /** Optional instance name to include in manifest */
  instanceName?: string;
  /** Progress callback */
  onProgress?: (event: BackupProgressEvent) => void;
}

/**
 * Tables to exclude from backup (system/internal tables).
 */
const EXCLUDED_TABLES = new Set([
  'sqlite_sequence',
  'sqlite_stat1',
  'sqlite_stat4',
  '__drizzle_migrations'
]);

/**
 * Detect the current platform.
 */
function detectPlatform(): BackupManifest['platform'] {
  if (typeof window !== 'undefined') {
    if ('electron' in window) return 'electron';
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/android/.test(ua)) return 'android';
  }
  return 'web';
}

/**
 * Get the app version from the build-time constant.
 */
function getAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
}

/**
 * Extract table schemas from the database.
 */
async function extractTableSchemas(
  adapter: DatabaseAdapter
): Promise<TableSchema[]> {
  const result = await adapter.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name"
  );

  const rows = result.rows as Array<{ name: string; sql: string }>;
  return rows
    .filter(
      (row) => !EXCLUDED_TABLES.has(row.name) && !row.name.startsWith('_')
    )
    .map((row) => ({
      name: row.name,
      sql: row.sql
    }));
}

/**
 * Extract index schemas from the database.
 */
async function extractIndexSchemas(
  adapter: DatabaseAdapter
): Promise<IndexSchema[]> {
  const result = await adapter.execute(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
  );

  const rows = result.rows as Array<{
    name: string;
    tbl_name: string;
    sql: string | null;
  }>;
  return rows
    .filter((row) => row.sql !== null && !row.name.startsWith('sqlite_'))
    .map((row) => ({
      name: row.name,
      tableName: row.tbl_name,
      sql: row.sql ?? ''
    }));
}

/**
 * Extract all data from a table.
 */
async function extractTableData(
  adapter: DatabaseAdapter,
  tableName: string
): Promise<unknown[]> {
  const result = await adapter.execute(`SELECT * FROM "${tableName}"`);
  return result.rows;
}

/**
 * Extract file metadata from the files table.
 */
async function extractFileMetadata(adapter: DatabaseAdapter): Promise<
  Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    storagePath: string;
  }>
> {
  const result = await adapter.execute(
    'SELECT id, name, size, mime_type, storage_path FROM files WHERE deleted = 0'
  );

  const rows = result.rows as Array<{
    id: string;
    name: string;
    size: number;
    mime_type: string;
    storage_path: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    storagePath: row.storage_path
  }));
}

/**
 * Create a backup of the database.
 *
 * @param adapter - SQLite adapter for database access
 * @param fileStorage - File storage for reading blobs (optional, required if includeBlobs is true)
 * @param options - Backup options
 * @returns The backup file as a Uint8Array
 */
export async function createBackup(
  adapter: DatabaseAdapter,
  fileStorage: FileStorage | null,
  options: CreateBackupOptions
): Promise<Uint8Array> {
  const { password, includeBlobs, instanceName, onProgress } = options;

  // Phase 1: Extract database content
  onProgress?.({
    phase: 'preparing',
    current: 0,
    total: 3,
    currentItem: 'Extracting database schema'
  });

  const tables = await extractTableSchemas(adapter);
  const indexes = await extractIndexSchemas(adapter);

  onProgress?.({
    phase: 'database',
    current: 1,
    total: 3,
    currentItem: 'Extracting table data'
  });

  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    data[table.name] = await extractTableData(adapter, table.name);
  }

  const database: BackupDatabase = { tables, indexes, data };

  // Phase 2: Collect blob information
  const blobs: BlobEntry[] = [];
  let blobTotalSize = 0;

  if (includeBlobs && fileStorage) {
    onProgress?.({
      phase: 'preparing',
      current: 2,
      total: 3,
      currentItem: 'Collecting file information'
    });

    const files = await extractFileMetadata(adapter);

    for (const file of files) {
      const exists = await fileStorage.exists(file.storagePath);
      if (exists) {
        blobs.push({
          path: file.storagePath,
          mimeType: file.mimeType,
          size: file.size
        });
        blobTotalSize += file.size;
      }
    }
  }

  // Phase 3: Create manifest
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    platform: detectPlatform(),
    appVersion: getAppVersion(),
    formatVersion: FORMAT_VERSION,
    blobCount: blobs.length,
    blobTotalSize,
    ...(instanceName && { instanceName })
  };

  // Phase 4: Encode backup
  const encodeOptions: EncodeOptions = {
    password,
    manifest,
    database,
    blobs,
    readBlob: async (path) => {
      if (!fileStorage) {
        throw new Error('File storage not available');
      }
      return fileStorage.retrieve(path);
    },
    ...(onProgress && { onProgress })
  };

  return encode(encodeOptions);
}

/**
 * Estimate the size of a backup before creating it.
 * Useful for showing progress or checking available space.
 */
export async function estimateBackupSize(
  adapter: DatabaseAdapter,
  fileStorage: FileStorage | null,
  includeBlobs: boolean
): Promise<{
  databaseSize: number;
  blobCount: number;
  blobTotalSize: number;
  estimatedTotal: number;
}> {
  // Estimate database size by summing table data
  const tables = await extractTableSchemas(adapter);
  let databaseSize = 0;

  for (const table of tables) {
    const data = await extractTableData(adapter, table.name);
    databaseSize += JSON.stringify(data).length;
  }

  // Get blob information
  let blobCount = 0;
  let blobTotalSize = 0;

  if (includeBlobs && fileStorage) {
    const files = await extractFileMetadata(adapter);
    for (const file of files) {
      const exists = await fileStorage.exists(file.storagePath);
      if (exists) {
        blobCount++;
        blobTotalSize += file.size;
      }
    }
  }

  // Estimate compressed size (rough: JSON compresses ~70%, blobs ~10%)
  const estimatedTotal =
    Math.ceil(databaseSize * 0.3) + Math.ceil(blobTotalSize * 0.9) + 1024;

  return {
    databaseSize,
    blobCount,
    blobTotalSize,
    estimatedTotal
  };
}
