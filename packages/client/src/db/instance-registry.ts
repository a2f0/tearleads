/**
 * Instance registry for multi-account support.
 * Stores instance metadata in IndexedDB (unencrypted) so the list
 * is visible before entering a password.
 */

const REGISTRY_DB_NAME = 'rapid_instance_registry';
const REGISTRY_STORE_NAME = 'registry';
const REGISTRY_KEY = 'instances';
const ACTIVE_INSTANCE_KEY = 'active_instance';

export interface InstanceMetadata {
  id: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
}

interface RegistryData {
  instances: InstanceMetadata[];
  activeInstanceId: string | null;
}

/**
 * Open the registry IndexedDB database.
 */
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

/**
 * Get a value from the registry store.
 */
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

/**
 * Set a value in the registry store.
 */
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

/**
 * Generate the next available instance name.
 * Returns "Instance 1", "Instance 2", etc.
 */
function generateInstanceName(existingInstances: InstanceMetadata[]): string {
  const existingNumbers = existingInstances
    .map((inst) => {
      const match = inst.name.match(/^Instance (\d+)$/);
      return match?.[1] ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  let nextNumber = 1;
  while (existingNumbers.includes(nextNumber)) {
    nextNumber++;
  }

  return `Instance ${nextNumber}`;
}

/**
 * Get all instances from the registry.
 */
export async function getInstances(): Promise<InstanceMetadata[]> {
  const instances = await getFromStore<InstanceMetadata[]>(REGISTRY_KEY);
  return instances ?? [];
}

/**
 * Get the active instance ID.
 */
export async function getActiveInstanceId(): Promise<string | null> {
  return getFromStore<string>(ACTIVE_INSTANCE_KEY);
}

/**
 * Get the active instance metadata.
 */
export async function getActiveInstance(): Promise<InstanceMetadata | null> {
  const activeId = await getActiveInstanceId();
  if (!activeId) return null;

  const instances = await getInstances();
  return instances.find((inst) => inst.id === activeId) ?? null;
}

/**
 * Set the active instance ID.
 */
export async function setActiveInstanceId(
  instanceId: string | null
): Promise<void> {
  await setInStore(ACTIVE_INSTANCE_KEY, instanceId);
}

/**
 * Create a new instance with auto-generated name.
 * Returns the new instance metadata.
 */
export async function createInstance(): Promise<InstanceMetadata> {
  const instances = await getInstances();
  const now = Date.now();

  const newInstance: InstanceMetadata = {
    id: crypto.randomUUID(),
    name: generateInstanceName(instances),
    createdAt: now,
    lastAccessedAt: now
  };

  instances.push(newInstance);
  await setInStore(REGISTRY_KEY, instances);

  return newInstance;
}

/**
 * Update an instance's metadata.
 */
export async function updateInstance(
  instanceId: string,
  updates: Partial<Pick<InstanceMetadata, 'name' | 'lastAccessedAt'>>
): Promise<void> {
  const instances = await getInstances();
  const existingInstance = instances.find((inst) => inst.id === instanceId);

  if (!existingInstance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  const index = instances.indexOf(existingInstance);
  instances[index] = {
    id: existingInstance.id,
    name: updates.name ?? existingInstance.name,
    createdAt: existingInstance.createdAt,
    lastAccessedAt: updates.lastAccessedAt ?? existingInstance.lastAccessedAt
  };
  await setInStore(REGISTRY_KEY, instances);
}

/**
 * Update the lastAccessedAt timestamp for an instance.
 */
export async function touchInstance(instanceId: string): Promise<void> {
  await updateInstance(instanceId, { lastAccessedAt: Date.now() });
}

/**
 * Delete an instance from the registry.
 * Note: This only removes the registry entry, not the actual data.
 * Data cleanup should be handled separately.
 */
export async function deleteInstanceFromRegistry(
  instanceId: string
): Promise<void> {
  const instances = await getInstances();
  const filtered = instances.filter((inst) => inst.id !== instanceId);
  await setInStore(REGISTRY_KEY, filtered);

  // If this was the active instance, clear the active ID
  const activeId = await getActiveInstanceId();
  if (activeId === instanceId) {
    await setActiveInstanceId(null);
  }
}

/**
 * Get an instance by ID.
 */
export async function getInstance(
  instanceId: string
): Promise<InstanceMetadata | null> {
  const instances = await getInstances();
  return instances.find((inst) => inst.id === instanceId) ?? null;
}

/**
 * Initialize the registry with a default instance if empty.
 * Returns the active instance (creating one if needed).
 */
export async function initializeRegistry(): Promise<InstanceMetadata> {
  const instances = await getInstances();
  const activeId = await getActiveInstanceId();

  // If no instances exist, create the first one
  if (instances.length === 0) {
    const newInstance = await createInstance();
    await setActiveInstanceId(newInstance.id);
    return newInstance;
  }

  // Find the active instance, or use the first one if not found
  let activeInstance = instances.find((inst) => inst.id === activeId);

  if (!activeInstance) {
    const firstInstance = instances[0];
    if (!firstInstance) {
      throw new Error('Unexpected: instances array is empty');
    }
    activeInstance = firstInstance;
    await setActiveInstanceId(activeInstance.id);
  }

  return activeInstance;
}

/**
 * Clear the entire registry (for testing or complete reset).
 */
export async function clearRegistry(): Promise<void> {
  const db = await openRegistryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(REGISTRY_STORE_NAME);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

/**
 * Get the full registry data (for debugging/testing).
 */
export async function getRegistryData(): Promise<RegistryData> {
  const [instances, activeInstanceId] = await Promise.all([
    getInstances(),
    getActiveInstanceId()
  ]);
  return { instances, activeInstanceId };
}
