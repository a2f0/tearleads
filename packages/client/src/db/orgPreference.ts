/**
 * Per-user active organization preference.
 * Stored in the same IndexedDB registry database as instance metadata,
 * keyed by `active_org_{userId}`.
 */

const REGISTRY_DB_NAME = 'tearleads_instance_registry';
const REGISTRY_STORE_NAME = 'registry';

async function openRegistryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REGISTRY_STORE_NAME)) {
        db.createObjectStore(REGISTRY_STORE_NAME);
      }
    };
  });
}

async function getFromStore<T>(key: string): Promise<T | null> {
  const db = await openRegistryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE_NAME, 'readonly');
    const store = tx.objectStore(REGISTRY_STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? null);

    tx.oncomplete = () => db.close();
  });
}

async function setInStore(key: string, value: unknown): Promise<void> {
  const db = await openRegistryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REGISTRY_STORE_NAME);
    const request = store.put(value, key);

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export async function getActiveOrgForUser(
  userId: string
): Promise<string | null> {
  return getFromStore<string>(`active_org_${userId}`);
}

export async function setActiveOrgForUser(
  userId: string,
  orgId: string
): Promise<void> {
  await setInStore(`active_org_${userId}`, orgId);
}

export async function clearActiveOrgForUser(userId: string): Promise<void> {
  await setInStore(`active_org_${userId}`, null);
}
