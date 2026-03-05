import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { emitInstanceChange } from '@/hooks/app';
import { toError } from '@/lib/errors';
import { databaseSetupProgressStore } from '@/stores/databaseSetupProgressStore';
import { logStore } from '@/stores/logStore';
import { notificationStore } from '@/stores/notificationStore';
import { validateAndPruneOrphanedInstances } from '../crypto/keyManager';
import type { Database } from '../index';
import {
  autoInitializeDatabase,
  hasPersistedSession,
  isDatabaseSetUp,
  restoreDatabaseSession
} from '../index';
import type { InstanceMetadata } from '../instanceRegistry';
import {
  deleteInstanceFromRegistry,
  getInstances,
  initializeRegistry,
  setActiveInstanceId,
  touchInstance,
  updateInstance
} from '../instanceRegistry';

interface InitializeDatabaseStateOptions {
  hadActiveSession: boolean;
  hasShownRecoveryNotification: MutableRefObject<boolean>;
  setCurrentInstanceId: Dispatch<SetStateAction<string | null>>;
  setCurrentInstanceName: Dispatch<SetStateAction<string | null>>;
  setDb: Dispatch<SetStateAction<Database | null>>;
  setError: Dispatch<SetStateAction<Error | null>>;
  setHasPersisted: Dispatch<SetStateAction<boolean>>;
  setInstances: Dispatch<SetStateAction<InstanceMetadata[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsSetUp: Dispatch<SetStateAction<boolean>>;
  markSessionActive: () => void;
}

function showUnexpectedReloadNotification(
  hadActiveSession: boolean,
  hasShownRecoveryNotification: MutableRefObject<boolean>
): void {
  if (hadActiveSession && !hasShownRecoveryNotification.current) {
    hasShownRecoveryNotification.current = true;
    notificationStore.warning(
      'Unexpected Reload',
      'App reloaded unexpectedly. Please unlock your database to continue.'
    );
  }
}

export async function initializeAndRestoreDatabaseState({
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
}: InitializeDatabaseStateOptions): Promise<void> {
  const initStart = performance.now();
  databaseSetupProgressStore.start();

  try {
    databaseSetupProgressStore.update('Preparing instance registry...', 10);
    let stepStart = performance.now();
    let activeInstance = await initializeRegistry();
    let allInstances = await getInstances();
    logStore.debug(
      `[db] registry init: ${(performance.now() - stepStart).toFixed(1)}ms`
    );

    databaseSetupProgressStore.update('Validating database instances...', 25);
    stepStart = performance.now();
    const cleanupResult = await validateAndPruneOrphanedInstances(
      allInstances.map((i) => i.id),
      deleteInstanceFromRegistry
    );

    if (cleanupResult.cleaned) {
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

      allInstances = await getInstances();

      if (allInstances.length === 0) {
        activeInstance = await initializeRegistry();
        allInstances = await getInstances();
      } else {
        const activeStillExists = allInstances.some(
          (i) => i.id === activeInstance.id
        );
        if (!activeStillExists && allInstances[0]) {
          activeInstance = allInstances[0];
          await setActiveInstanceId(activeInstance.id);
        }
      }
    }

    setInstances(allInstances);
    setCurrentInstanceId(activeInstance.id);
    setCurrentInstanceName(activeInstance.name);
    emitInstanceChange(activeInstance.id);

    logStore.debug(
      `[db] validate & prune: ${(performance.now() - stepStart).toFixed(1)}ms`
    );

    databaseSetupProgressStore.update('Checking database state...', 40);
    stepStart = performance.now();
    const [setup, persisted] = await Promise.all([
      isDatabaseSetUp(activeInstance.id),
      hasPersistedSession(activeInstance.id)
    ]);
    setIsSetUp(setup);
    setHasPersisted(persisted);
    logStore.debug(
      `[db] check state: ${(performance.now() - stepStart).toFixed(1)}ms`
    );

    if (persisted) {
      databaseSetupProgressStore.update('Restoring database session...', 55);
      const database = await restoreDatabaseSession(activeInstance.id);
      if (database) {
        databaseSetupProgressStore.update('Ready', 100);
        setDb(database);
        markSessionActive();
        await touchInstance(activeInstance.id);
      } else {
        setHasPersisted(false);
        showUnexpectedReloadNotification(
          hadActiveSession,
          hasShownRecoveryNotification
        );
      }
    } else if (setup) {
      showUnexpectedReloadNotification(
        hadActiveSession,
        hasShownRecoveryNotification
      );
    } else {
      databaseSetupProgressStore.update('Loading database engine...', 55);
      const database = await autoInitializeDatabase(activeInstance.id);
      const persistedAfterAutoInit = await hasPersistedSession(
        activeInstance.id
      );
      databaseSetupProgressStore.update('Ready', 100);
      setDb(database);
      setIsSetUp(true);
      setHasPersisted(persistedAfterAutoInit);
      markSessionActive();
      await updateInstance(activeInstance.id, { passwordDeferred: true });
      setInstances(await getInstances());
      await touchInstance(activeInstance.id);
    }
  } catch (err) {
    setError(toError(err));
  } finally {
    logStore.debug(
      `[db] initializeAndRestoreDatabaseState total: ${(performance.now() - initStart).toFixed(1)}ms`
    );
    databaseSetupProgressStore.finish();
    setIsLoading(false);
  }
}
