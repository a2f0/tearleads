import type { SQLiteConnection } from '@capacitor-community/sqlite';

/**
 * Error messages that can be safely ignored when deleting a database.
 * These occur when the database doesn't exist (fresh install, already deleted, etc.)
 * or when there's no active connection to it.
 */
const IGNORABLE_DELETE_DB_ERRORS = [
  'not found',
  'does not exist',
  'no available connection'
];

/**
 * Check if a database deletion error should be ignored.
 * Returns true if the error indicates the database simply doesn't exist.
 */
export function isIgnorableDeleteDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return IGNORABLE_DELETE_DB_ERRORS.some((msg) => message.includes(msg));
}

interface FilesystemDeleteTarget {
  directory: 'DATA' | 'LIBRARY';
  path: string;
}

/**
 * Best-effort direct database file deletion for stale-file recovery.
 * iOS stores DB files under Library/CapacitorDatabase, while Android uses
 * ../databases relative to Directory.Data.
 */
export async function deleteCapacitorDatabaseFile(
  databaseName: string
): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  const dbFileName = `${databaseName}SQLite.db`;
  const platform = Capacitor.getPlatform();

  const targets: FilesystemDeleteTarget[] =
    platform === 'ios'
      ? [{ path: `CapacitorDatabase/${dbFileName}`, directory: 'LIBRARY' }]
      : [
          { path: `../databases/${dbFileName}`, directory: 'DATA' },
          { path: `CapacitorDatabase/${dbFileName}`, directory: 'LIBRARY' }
        ];

  let lastError: unknown = null;
  for (const target of targets) {
    try {
      await Filesystem.deleteFile({
        path: target.path,
        directory:
          target.directory === 'LIBRARY' ? Directory.Library : Directory.Data
      });
      return;
    } catch (error: unknown) {
      // Try the next candidate path.
      lastError = error;
    }
  }

  if (lastError) {
    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    console.warn(
      `Failed to delete stale Capacitor DB file for ${databaseName}: ${message}`
    );
  }
}

let sqliteConnection: SQLiteConnection | null = null;

export async function getSQLiteConnection(): Promise<SQLiteConnection> {
  if (sqliteConnection) return sqliteConnection;

  const { CapacitorSQLite, SQLiteConnection } = await import(
    '@capacitor-community/sqlite'
  );

  // Test that the plugin is properly initialized by calling echo
  // This catches the "CapacitorSQLitePlugin: null" error early with a better message
  try {
    await CapacitorSQLite.echo({ value: 'test' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('CapacitorSQLitePlugin') && message.includes('null')) {
      throw new Error(
        'SQLite plugin failed to initialize. Try clearing app data in Settings > Apps > Tearleads > Clear Storage, then reopen the app.'
      );
    }
    throw err;
  }

  const connection = new SQLiteConnection(CapacitorSQLite);
  sqliteConnection = connection;
  return sqliteConnection;
}

export function resetSQLiteConnectionCache(): void {
  sqliteConnection = null;
}
