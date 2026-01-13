/**
 * React hooks for database access.
 * Supports multi-instance with instance switching.
 */

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { toast } from 'sonner';
import {
  clearSessionActive,
  getLastLoadedModel,
  markSessionActive,
  wasSessionActive
} from '@/hooks/useAppLifecycle';
import { emitInstanceChange } from '@/hooks/useInstanceChange';
import { toError } from '@/lib/errors';
import { deleteFileStorageForInstance } from '@/storage/opfs';
import { logStore } from '@/stores/logStore';
import { validateAndPruneOrphanedInstances } from '../crypto/key-manager';
import type { Database } from '../index';
import {
  changePassword,
  clearPersistedSession,
  closeDatabase,
  exportDatabase,
  hasPersistedSession,
  importDatabase,
  isDatabaseSetUp,
  persistDatabaseSession,
  resetDatabase,
  restoreDatabaseSession,
  setupDatabase,
  unlockDatabase
} from '../index';
import type { InstanceMetadata } from '../instance-registry';
import {
  createInstance as createRegistryInstance,
  deleteInstanceFromRegistry,
  getInstances,
  initializeRegistry,
  setActiveInstanceId,
  touchInstance
} from '../instance-registry';

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
  /** Whether there's a persisted session available (web only) */
  hasPersistedSession: boolean;

  // Multi-instance fields
  /** Current instance ID */
  currentInstanceId: string | null;
  /** Current instance name */
  currentInstanceName: string | null;
  /** List of all instances */
  instances: InstanceMetadata[];

  /** Set up a new database with a password */
  setup: (password: string) => Promise<boolean>;
  /** Unlock an existing database with a password */
  unlock: (password: string, persistSession?: boolean) => Promise<boolean>;
  /** Restore the database from a persisted session (web only) */
  restoreSession: () => Promise<boolean>;
  /** Persist the current session for restoration on reload (web only) */
  persistSession: () => Promise<boolean>;
  /** Clear any persisted session data without locking */
  clearPersistedSession: () => Promise<void>;
  /** Lock the database (close and clear key) */
  lock: (clearSession?: boolean) => Promise<void>;
  /** Change the database password */
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<boolean>;
  /** Reset the current database (wipe everything) */
  reset: () => Promise<void>;
  /** Export the database to a byte array */
  exportDatabase: () => Promise<Uint8Array>;
  /** Import a database from a byte array */
  importDatabase: (data: Uint8Array) => Promise<void>;

  // Multi-instance methods
  /** Create a new instance and switch to it */
  createInstance: () => Promise<string>;
  /** Switch to a different instance */
  switchInstance: (instanceId: string) => Promise<boolean>;
  /** Delete an instance */
  deleteInstance: (instanceId: string) => Promise<void>;
  /** Refresh the instances list */
  refreshInstances: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

interface DatabaseProviderProps {
  children: ReactNode;
}

/**
 * Provider component for database access.
 * Supports multi-instance with instance switching.
 */
export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [db, setDb] = useState<Database | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSetUp, setIsSetUp] = useState(false);
  const [hasPersisted, setHasPersisted] = useState(false);

  // Multi-instance state
  const [currentInstanceId, setCurrentInstanceId] = useState<string | null>(
    null
  );
  const [currentInstanceName, setCurrentInstanceName] = useState<string | null>(
    null
  );
  const [instances, setInstances] = useState<InstanceMetadata[]>([]);

  // Track if we've shown the recovery toast (to avoid duplicates)
  const hasShownRecoveryToast = useRef(false);

  // Initialize registry and check for active instance on mount
  useEffect(() => {
    async function initializeAndRestore() {
      // Check if there was an active session before page load
      const hadActiveSession = wasSessionActive();

      try {
        // Initialize the instance registry (creates default instance if needed)
        let activeInstance = await initializeRegistry();

        // Get instance-scoped previous model (must be after we know the active instance)
        const previousModel = getLastLoadedModel(activeInstance.id);

        // Load all instances and validate for orphans
        let allInstances = await getInstances();

        // Prune orphaned Keystore and registry entries
        // This handles cases where Android Keystore entries survive app uninstall
        const cleanupResult = await validateAndPruneOrphanedInstances(
          allInstances.map((i) => i.id),
          deleteInstanceFromRegistry
        );

        if (cleanupResult.cleaned) {
          // Log warnings about cleaned up orphans
          if (cleanupResult.orphanedKeystoreEntries.length > 0) {
            logStore.warn(
              `Pruned ${cleanupResult.orphanedKeystoreEntries.length} orphaned Keystore entries`,
              `Instance IDs: ${cleanupResult.orphanedKeystoreEntries.join(', ')}`
            );
          }
          if (cleanupResult.orphanedRegistryEntries.length > 0) {
            logStore.warn(
              `Pruned ${cleanupResult.orphanedRegistryEntries.length} orphaned registry entries`,
              `Instance IDs: ${cleanupResult.orphanedRegistryEntries.join(', ')}`
            );
          }

          // Reload instances after cleanup
          allInstances = await getInstances();

          // Re-initialize registry if the active instance was cleaned up
          if (allInstances.length === 0) {
            activeInstance = await initializeRegistry();
            allInstances = await getInstances();
          } else {
            // Check if active instance still exists
            const activeStillExists = allInstances.some(
              (i) => i.id === activeInstance.id
            );
            if (!activeStillExists && allInstances[0]) {
              // Use first available instance as active
              activeInstance = allInstances[0];
              await setActiveInstanceId(activeInstance.id);
            }
          }
        }

        setInstances(allInstances);

        // Set current instance
        setCurrentInstanceId(activeInstance.id);
        setCurrentInstanceName(activeInstance.name);
        emitInstanceChange(activeInstance.id);

        // Check setup status and persisted session for active instance
        const [setup, persisted] = await Promise.all([
          isDatabaseSetUp(activeInstance.id),
          hasPersistedSession(activeInstance.id)
        ]);
        setIsSetUp(setup);
        setHasPersisted(persisted);

        // Auto-restore session if available
        if (persisted) {
          const database = await restoreDatabaseSession(activeInstance.id);
          if (database) {
            setDb(database);
            markSessionActive();
            await touchInstance(activeInstance.id);

            // If session restored but model was lost, notify user
            if (
              previousModel &&
              hadActiveSession &&
              !hasShownRecoveryToast.current
            ) {
              hasShownRecoveryToast.current = true;
              toast.info(
                'App reloaded. Your session was restored, but the model needs to be reloaded.',
                { duration: 5000 }
              );
            }
          } else {
            // Session restore failed, clear the invalid session
            setHasPersisted(false);
            showUnexpectedReloadToast();
          }
        } else if (setup) {
          showUnexpectedReloadToast();
        }

        // Helper to show toast for unexpected reloads (DRY)
        function showUnexpectedReloadToast() {
          if (hadActiveSession && !hasShownRecoveryToast.current) {
            hasShownRecoveryToast.current = true;
            toast.warning(
              'App reloaded unexpectedly. Please unlock your database to continue.',
              { duration: 5000 }
            );
          }
        }
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsLoading(false);
      }
    }

    initializeAndRestore();
  }, []);

  const refreshInstances = useCallback(async (): Promise<void> => {
    const allInstances = await getInstances();
    setInstances(allInstances);
  }, []);

  const setup = useCallback(
    async (password: string): Promise<boolean> => {
      if (!currentInstanceId) {
        throw new Error('No active instance');
      }

      setIsLoading(true);
      setError(null);

      try {
        const database = await setupDatabase(password, currentInstanceId);
        setDb(database);
        setIsSetUp(true);
        markSessionActive();
        await touchInstance(currentInstanceId);
        return true;
      } catch (err) {
        console.error('Database setup error:', err);
        setError(toError(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [currentInstanceId]
  );

  const unlock = useCallback(
    async (password: string, persistSession = false): Promise<boolean> => {
      if (!currentInstanceId) {
        throw new Error('No active instance');
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await unlockDatabase(
          password,
          currentInstanceId,
          persistSession
        );
        if (result) {
          setDb(result.db);
          markSessionActive();
          if (result.sessionPersisted) {
            setHasPersisted(true);
          }
          await touchInstance(currentInstanceId);
          return true;
        }
        return false; // Wrong password
      } catch (err) {
        setError(toError(err));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [currentInstanceId]
  );

  const restoreSession = useCallback(async (): Promise<boolean> => {
    if (!currentInstanceId) {
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const database = await restoreDatabaseSession(currentInstanceId);
      if (database) {
        setDb(database);
        markSessionActive();
        await touchInstance(currentInstanceId);
        return true;
      }
      // No persisted session or restoration failed
      setHasPersisted(false);
      return false;
    } catch (err) {
      setError(toError(err));
      setHasPersisted(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [currentInstanceId]);

  const persistSession = useCallback(async (): Promise<boolean> => {
    if (!currentInstanceId || !db) {
      return false;
    }

    try {
      const persisted = await persistDatabaseSession(currentInstanceId);
      setHasPersisted(persisted);
      return persisted;
    } catch (err) {
      setError(toError(err));
      return false;
    }
  }, [currentInstanceId, db]);

  const clearPersistedSessionHandler = useCallback(async (): Promise<void> => {
    if (!currentInstanceId) {
      return;
    }

    try {
      await clearPersistedSession(currentInstanceId);
      setHasPersisted(false);
    } catch (err) {
      setError(toError(err));
    }
  }, [currentInstanceId]);

  const lock = useCallback(
    async (clearSessionFlag = false): Promise<void> => {
      try {
        await closeDatabase();
        setDb(null);
        // Clear session active flag when user explicitly locks
        clearSessionActive();

        if (clearSessionFlag && currentInstanceId) {
          await clearPersistedSession(currentInstanceId);
          setHasPersisted(false);
        }
      } catch (err) {
        setError(toError(err));
      }
    },
    [currentInstanceId]
  );

  const handleChangePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<boolean> => {
      try {
        return await changePassword(oldPassword, newPassword);
      } catch (err) {
        setError(toError(err));
        return false;
      }
    },
    []
  );

  const reset = useCallback(async (): Promise<void> => {
    if (!currentInstanceId) {
      return;
    }

    try {
      await resetDatabase(currentInstanceId);
      setDb(null);
      setIsSetUp(false);
      setHasPersisted(false);
    } catch (err) {
      setError(toError(err));
    }
  }, [currentInstanceId]);

  const handleExportDatabase = useCallback(async (): Promise<Uint8Array> => {
    try {
      return await exportDatabase();
    } catch (err) {
      setError(toError(err));
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
        setError(toError(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Multi-instance methods

  const createInstance = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      // Close current database if open
      if (db) {
        await closeDatabase();
        setDb(null);
      }

      // Create new instance in registry
      const newInstance = await createRegistryInstance();

      // Update state
      await setActiveInstanceId(newInstance.id);
      setCurrentInstanceId(newInstance.id);
      setCurrentInstanceName(newInstance.name);
      emitInstanceChange(newInstance.id);
      setIsSetUp(false);
      setHasPersisted(false);

      // Refresh instances list
      await refreshInstances();

      return newInstance.id;
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [db, refreshInstances]);

  const switchInstance = useCallback(
    async (targetInstanceId: string): Promise<boolean> => {
      if (targetInstanceId === currentInstanceId) {
        return true; // Already on this instance
      }

      setIsLoading(true);
      setError(null);

      try {
        // Close current database if open
        if (db) {
          await closeDatabase();
          setDb(null);
        }

        // Update active instance in registry
        await setActiveInstanceId(targetInstanceId);

        // Find instance metadata
        const allInstances = await getInstances();
        const targetInstance = allInstances.find(
          (i) => i.id === targetInstanceId
        );

        if (!targetInstance) {
          throw new Error(`Instance not found: ${targetInstanceId}`);
        }

        // Update state
        setCurrentInstanceId(targetInstanceId);
        setCurrentInstanceName(targetInstance.name);
        emitInstanceChange(targetInstanceId);
        setInstances(allInstances);

        // Check setup status and persisted session for target instance
        const [setup, persisted] = await Promise.all([
          isDatabaseSetUp(targetInstanceId),
          hasPersistedSession(targetInstanceId)
        ]);
        setIsSetUp(setup);
        setHasPersisted(persisted);

        // Try session restore if available
        if (persisted) {
          const database = await restoreDatabaseSession(targetInstanceId);
          if (database) {
            setDb(database);
            await touchInstance(targetInstanceId);
            setIsLoading(false);
            return true;
          }
          // Session restore failed
          setHasPersisted(false);
        }

        setIsLoading(false);
        // Return true if set up (needs unlock), false if not set up (needs setup)
        return setup;
      } catch (err) {
        setError(toError(err));
        setIsLoading(false);
        return false;
      }
    },
    [currentInstanceId, db]
  );

  const deleteInstance = useCallback(
    async (instanceId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const allInstances = await getInstances();

        // Can't delete the last instance
        if (allInstances.length <= 1) {
          throw new Error('Cannot delete the last instance');
        }

        // If deleting current instance, switch to another first
        if (instanceId === currentInstanceId) {
          const otherInstance = allInstances.find((i) => i.id !== instanceId);
          if (otherInstance) {
            // switchInstance returns false if target isn't set up yet, which is
            // fine when deleting - we just need to switch away from the deleted one.
            // Actual errors throw and are caught by the try/catch block.
            await switchInstance(otherInstance.id);
          }
        }

        // Delete database and key storage
        await resetDatabase(instanceId);

        // Delete file storage
        await deleteFileStorageForInstance(instanceId);

        // Remove from registry
        await deleteInstanceFromRegistry(instanceId);

        // Refresh instances list
        await refreshInstances();
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [currentInstanceId, switchInstance, refreshInstances]
  );

  const value = useMemo(
    (): DatabaseContextValue => ({
      db,
      isLoading,
      error,
      isSetUp,
      isUnlocked: db !== null,
      hasPersistedSession: hasPersisted,
      currentInstanceId,
      currentInstanceName,
      instances,
      setup,
      unlock,
      restoreSession,
      persistSession,
      clearPersistedSession: clearPersistedSessionHandler,
      lock,
      changePassword: handleChangePassword,
      reset,
      exportDatabase: handleExportDatabase,
      importDatabase: handleImportDatabase,
      createInstance,
      switchInstance,
      deleteInstance,
      refreshInstances
    }),
    [
      db,
      isLoading,
      error,
      isSetUp,
      hasPersisted,
      currentInstanceId,
      currentInstanceName,
      instances,
      setup,
      unlock,
      restoreSession,
      persistSession,
      clearPersistedSessionHandler,
      lock,
      handleChangePassword,
      reset,
      handleExportDatabase,
      handleImportDatabase,
      createInstance,
      switchInstance,
      deleteInstance,
      refreshInstances
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
