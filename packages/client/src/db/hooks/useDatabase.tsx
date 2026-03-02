import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearSessionActive,
  emitInstanceChange,
  markSessionActive,
  wasSessionActive
} from '@/hooks/app';
import { toError } from '@/lib/errors';
import { deleteFileStorageForInstance } from '@/storage/opfs';
import type { Database } from '../index';
import {
  autoInitializeDatabase,
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
import type { InstanceMetadata } from '../instanceRegistry';
import {
  createInstance as createRegistryInstance,
  deleteInstanceFromRegistry,
  getInstances,
  setActiveInstanceId,
  touchInstance,
  updateInstance
} from '../instanceRegistry';
import { DatabaseContext } from './useDatabaseContext';
import { initializeAndRestoreDatabaseState } from './useDatabaseInitialization';
import type {
  DatabaseContextValue,
  DatabaseProviderProps
} from './useDatabaseTypes';

export { useDatabaseContext } from './useDatabaseContext';

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [db, setDb] = useState<Database | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSetUp, setIsSetUp] = useState(false);
  const [hasPersisted, setHasPersisted] = useState(false);

  const [currentInstanceId, setCurrentInstanceId] = useState<string | null>(
    null
  );
  const [currentInstanceName, setCurrentInstanceName] = useState<string | null>(
    null
  );
  const [instances, setInstances] = useState<InstanceMetadata[]>([]);

  const hasShownRecoveryNotification = useRef(false);

  useEffect(() => {
    async function initializeAndRestore() {
      const hadActiveSession = wasSessionActive();
      await initializeAndRestoreDatabaseState({
        hadActiveSession,
        hasShownRecoveryNotification,
        setCurrentInstanceId,
        setCurrentInstanceName,
        setDb,
        setError,
        setHasPersisted,
        setInstances,
        setIsLoading,
        setIsSetUp,
        markSessionActive
      });
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
        await persistDatabaseSession(currentInstanceId);
        setHasPersisted(true);
        await updateInstance(currentInstanceId, { passwordDeferred: false });
        setInstances(await getInstances());
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
      throw err;
    }
  }, [currentInstanceId]);

  const lock = useCallback(
    async (clearSessionFlag = false): Promise<void> => {
      try {
        await closeDatabase();
        setDb(null);
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

  const createInstance = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      if (db) {
        await closeDatabase();
        setDb(null);
      }

      const newInstance = await createRegistryInstance();

      await setActiveInstanceId(newInstance.id);
      setCurrentInstanceId(newInstance.id);
      setCurrentInstanceName(newInstance.name);
      emitInstanceChange(newInstance.id);
      const database = await autoInitializeDatabase(newInstance.id);
      setDb(database);
      setIsSetUp(true);
      setHasPersisted(true);
      await updateInstance(newInstance.id, { passwordDeferred: true });
      await refreshInstances();
      markSessionActive();
      await touchInstance(newInstance.id);

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
        return true;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (db) {
          await closeDatabase();
          setDb(null);
        }

        await setActiveInstanceId(targetInstanceId);

        const allInstances = await getInstances();
        const targetInstance = allInstances.find(
          (i) => i.id === targetInstanceId
        );

        if (!targetInstance) {
          throw new Error(`Instance not found: ${targetInstanceId}`);
        }

        setCurrentInstanceId(targetInstanceId);
        setCurrentInstanceName(targetInstance.name);
        emitInstanceChange(targetInstanceId);
        setInstances(allInstances);

        const [setup, persisted] = await Promise.all([
          isDatabaseSetUp(targetInstanceId),
          hasPersistedSession(targetInstanceId)
        ]);
        setIsSetUp(setup);
        setHasPersisted(persisted);

        if (persisted) {
          const database = await restoreDatabaseSession(targetInstanceId);
          if (database) {
            setDb(database);
            markSessionActive();
            await touchInstance(targetInstanceId);
            setIsLoading(false);
            return true;
          }
          setHasPersisted(false);
        }

        if (!setup) {
          const database = await autoInitializeDatabase(targetInstanceId);
          setDb(database);
          setIsSetUp(true);
          setHasPersisted(true);
          await updateInstance(targetInstanceId, { passwordDeferred: true });
          setInstances(await getInstances());
          markSessionActive();
          await touchInstance(targetInstanceId);
          setIsLoading(false);
          return true;
        }

        setIsLoading(false);
        return true;
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

        if (allInstances.length <= 1) {
          throw new Error('Cannot delete the last instance');
        }

        if (instanceId === currentInstanceId) {
          const otherInstance = allInstances.find((i) => i.id !== instanceId);
          if (otherInstance) {
            await switchInstance(otherInstance.id);
          }
        }

        await resetDatabase(instanceId);

        await deleteFileStorageForInstance(instanceId);

        await deleteInstanceFromRegistry(instanceId);

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
