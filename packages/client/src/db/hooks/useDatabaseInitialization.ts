import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { emitInstanceChange } from '@/hooks/app';
import { toError } from '@/lib/errors';
import { logStore } from '@/stores/logStore';
import { notificationStore } from '@/stores/notificationStore';
import { validateAndPruneOrphanedInstances } from '../crypto/keyManager';
import type { Database } from '../index';
import {
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
  touchInstance
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
  try {
    let activeInstance = await initializeRegistry();
    let allInstances = await getInstances();

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

    const [setup, persisted] = await Promise.all([
      isDatabaseSetUp(activeInstance.id),
      hasPersistedSession(activeInstance.id)
    ]);
    setIsSetUp(setup);
    setHasPersisted(persisted);

    if (persisted) {
      const database = await restoreDatabaseSession(activeInstance.id);
      if (database) {
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
    }
  } catch (err) {
    setError(toError(err));
  } finally {
    setIsLoading(false);
  }
}
