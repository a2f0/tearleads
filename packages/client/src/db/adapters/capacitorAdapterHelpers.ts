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
