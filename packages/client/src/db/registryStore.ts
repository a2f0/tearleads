/**
 * Shared IndexedDB helpers for the tearleads instance registry.
 * Used by orgPreference and orgBackfill to persist per-user flags.
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

export async function getFromStore<T>(key: string): Promise<T | null> {
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

export async function setInStore(key: string, value: unknown): Promise<void> {
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
