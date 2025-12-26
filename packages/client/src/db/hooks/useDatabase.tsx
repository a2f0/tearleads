/**
 * React hooks for database access.
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import type { Database } from '../index';
import {
  changePassword,
  closeDatabase,
  exportDatabase,
  importDatabase,
  isDatabaseSetUp,
  resetDatabase,
  setupDatabase,
  unlockDatabase
} from '../index';

interface DatabaseContextValue {
  /** The database instance (null if not unlocked) */
  db: Database | null;
  /** Whether the database is currently loading/initializing */
  isLoading: boolean;
  /** Error if database initialization failed */
  error: Error | null;
  /** Whether a database has been set up (has encryption key) */
  isSetUp: boolean;
  /** Whether the database is currently unlocked */
  isUnlocked: boolean;
  /** Set up a new database with a password */
  setup: (password: string) => Promise<boolean>;
  /** Unlock an existing database with a password */
  unlock: (password: string) => Promise<boolean>;
  /** Lock the database (close and clear key) */
  lock: () => Promise<void>;
  /** Change the database password */
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<boolean>;
  /** Reset the database (wipe everything) */
  reset: () => Promise<void>;
  /** Export the database to a byte array */
  exportDatabase: () => Promise<Uint8Array>;
  /** Import a database from a byte array */
  importDatabase: (data: Uint8Array) => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

interface DatabaseProviderProps {
  children: ReactNode;
}

/**
 * Provider component for database access.
 */
export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [db, setDb] = useState<Database | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSetUp, setIsSetUp] = useState(false);

  // Check if database is set up on mount
  useEffect(() => {
    async function checkSetup() {
      try {
        const setup = await isDatabaseSetUp();
        setIsSetUp(setup);
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    }

    checkSetup();
  }, []);

  const setup = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const database = await setupDatabase(password);
      setDb(database);
      setIsSetUp(true);
      return true;
    } catch (err) {
      console.error('Database setup error:', err);
      setError(err as Error);
      throw err; // Re-throw so caller can see the error
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const database = await unlockDatabase(password);
      if (database) {
        setDb(database);
        return true;
      }
      return false; // Wrong password
    } catch (err) {
      setError(err as Error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const lock = useCallback(async (): Promise<void> => {
    try {
      await closeDatabase();
      setDb(null);
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  const handleChangePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<boolean> => {
      try {
        return await changePassword(oldPassword, newPassword);
      } catch (err) {
        setError(err as Error);
        return false;
      }
    },
    []
  );

  const reset = useCallback(async (): Promise<void> => {
    try {
      await resetDatabase();
      setDb(null);
      setIsSetUp(false);
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  const handleExportDatabase = useCallback(async (): Promise<Uint8Array> => {
    try {
      return await exportDatabase();
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  const handleImportDatabase = useCallback(
    async (data: Uint8Array): Promise<void> => {
      setIsLoading(true);
      try {
        await importDatabase(data);
        // Clear db state - user will need to unlock again with same password
        setDb(null);
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const value = useMemo(
    (): DatabaseContextValue => ({
      db,
      isLoading,
      error,
      isSetUp,
      isUnlocked: db !== null,
      setup,
      unlock,
      lock,
      changePassword: handleChangePassword,
      reset,
      exportDatabase: handleExportDatabase,
      importDatabase: handleImportDatabase
    }),
    [
      db,
      isLoading,
      error,
      isSetUp,
      setup,
      unlock,
      lock,
      handleChangePassword,
      reset,
      handleExportDatabase,
      handleImportDatabase
    ]
  );

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
}

/**
 * Hook to access the database context.
 */
export function useDatabaseContext(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error(
      'useDatabaseContext must be used within a DatabaseProvider'
    );
  }
  return context;
}

/**
 * Hook to access the database instance.
 * Throws if the database is not unlocked.
 */
export function useDatabase(): Database {
  const { db, isUnlocked } = useDatabaseContext();
  if (!isUnlocked || !db) {
    throw new Error(
      'Database is not unlocked. Use useDatabaseContext for conditional access.'
    );
  }
  return db;
}

/**
 * Hook to access the database if it's unlocked.
 * Returns null if the database is not unlocked.
 */
export function useDatabaseOptional(): Database | null {
  const { db } = useDatabaseContext();
  return db;
}
