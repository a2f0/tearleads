import { setAnalyticsAdapter } from '@tearleads/analytics/analyticsState';
import { getKeyManagerForInstance } from './crypto';
import { _getAdapterInstance, _setDatabaseInstance } from './state';

let databaseLifecycleTail: Promise<void> = Promise.resolve();

export async function runWithDatabaseLifecycleLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  const lockedOperation = databaseLifecycleTail.then(operation, operation);
  databaseLifecycleTail = lockedOperation.then(
    () => undefined,
    () => undefined
  );
  return lockedOperation;
}

export function markDatabaseServicesUnavailable(): void {
  _setDatabaseInstance(null);
  setAnalyticsAdapter(null);
}

export async function closeDatabaseForInstance(
  instanceId: string | null
): Promise<void> {
  const adapterInstance = _getAdapterInstance();

  markDatabaseServicesUnavailable();

  try {
    if (adapterInstance) {
      await adapterInstance.close();
    }
  } finally {
    if (instanceId) {
      const keyManager = getKeyManagerForInstance(instanceId);
      keyManager.clearKey();
    }
  }
}
