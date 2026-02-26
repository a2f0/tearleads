/**
 * Instance registry for multi-account support.
 * Stores instance metadata in IndexedDB (unencrypted) so the list
 * is visible before entering a password.
 */

import {
  getTestInstanceId,
  isTestInstance,
  isTestMode
} from '@/lib/testInstance';

const REGISTRY_DB_NAME = 'tearleads_instance_registry';
const REGISTRY_STORE_NAME = 'registry';
const REGISTRY_KEY = 'instances';
const ACTIVE_INSTANCE_KEY = 'active_instance';

/**
 * Module-level initialization lock to prevent race conditions.
 * When initializeRegistry() is called concurrently (e.g., due to React StrictMode),
 * all calls will await the same promise, ensuring only one initialization occurs.
 */
let initializationPromise: Promise<InstanceMetadata> | null = null;

/**
 * Reset the initialization state. For testing purposes only.
 * This allows tests to start fresh without the cached initialization promise.
 */
export function resetInitializationState(): void {
  initializationPromise = null;
}

export interface InstanceMetadata {
  id: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
  boundUserId?: string | null;
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
  updates: Partial<
    Pick<InstanceMetadata, 'name' | 'lastAccessedAt' | 'boundUserId'>
  >
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
    lastAccessedAt: updates.lastAccessedAt ?? existingInstance.lastAccessedAt,
    boundUserId:
      updates.boundUserId === undefined
        ? (existingInstance.boundUserId ?? null)
        : updates.boundUserId
  };
  await setInStore(REGISTRY_KEY, instances);
}

export async function getInstanceForUser(
  userId: string
): Promise<InstanceMetadata | null> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return null;
  }

  const instances = await getInstances();
  return (
    instances.find((instance) => instance.boundUserId === normalizedUserId) ??
    null
  );
}

export async function bindInstanceToUser(
  instanceId: string,
  userId: string
): Promise<void> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error('userId is required');
  }

  const instances = await getInstances();
  const target = instances.find((instance) => instance.id === instanceId);
  if (!target) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  let changed = false;
  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index];
    if (!instance) {
      continue;
    }

    if (instance.id === instanceId) {
      if (instance.boundUserId !== normalizedUserId) {
        instances[index] = {
          ...instance,
          boundUserId: normalizedUserId
        };
        changed = true;
      }
    } else if (instance.boundUserId === normalizedUserId) {
      instances[index] = {
        ...instance,
        boundUserId: null
      };
      changed = true;
    }
  }

  if (changed) {
    await setInStore(REGISTRY_KEY, instances);
  }
}

/**
 * Update the lastAccessedAt timestamp for an instance.
 * Silently returns if the instance doesn't exist (e.g., after storage was cleared).
 */
export async function touchInstance(instanceId: string): Promise<void> {
  try {
    await updateInstance(instanceId, { lastAccessedAt: Date.now() });
  } catch (err) {
    // Instance may have been deleted (e.g., storage cleared during testing)
    // This is non-critical - just skip the timestamp update
    if (err instanceof Error && err.message.includes('Instance not found')) {
      return;
    }
    throw err;
  }
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
 *
 * In test mode (Playwright), uses a deterministic instance ID based on
 * the worker index to enable parallel test execution without OPFS conflicts.
 *
 * This function is idempotent - concurrent calls (e.g., from React StrictMode)
 * will return the same promise, preventing duplicate instance creation.
 */
export async function initializeRegistry(): Promise<InstanceMetadata> {
  // In test mode, skip caching - each test worker needs its own initialization
  // and the worker ID may differ between calls in parallel test execution.
  if (isTestMode()) {
    return initializeRegistryInternal();
  }

  // If initialization is already in progress, return the existing promise
  // to prevent race conditions from concurrent calls (e.g., React StrictMode)
  if (initializationPromise) {
    // Verify the cached instance still exists (storage may have been cleared)
    const cached = await initializationPromise;
    const stillExists = await getInstance(cached.id);
    if (stillExists) {
      return cached;
    }
    // Instance was deleted (e.g., storage cleared), re-initialize
    initializationPromise = null;
  }

  const promise = initializeRegistryInternal();
  initializationPromise = promise;

  // If initialization fails, reset the promise to allow retries on subsequent calls.
  // This prevents the registry from being permanently "poisoned" by a failed
  // initialization attempt.
  promise.catch(() => {
    if (initializationPromise === promise) {
      initializationPromise = null;
    }
  });

  return promise;
}

/**
 * Internal initialization logic, called only once per app lifecycle.
 */
async function initializeRegistryInternal(): Promise<InstanceMetadata> {
  // In test mode, use a deterministic instance ID for the worker
  if (isTestMode()) {
    const testInstanceId = getTestInstanceId();
    if (testInstanceId) {
      return initializeTestInstance(testInstanceId);
    }
  }

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
 * Initialize a test-specific instance with a deterministic ID.
 * Creates the instance if it doesn't exist, or returns existing one.
 *
 * For parallel test isolation, we need to ensure each worker uses its own
 * test instance. However, within a single test, we want to respect the stored
 * active instance (which may be a user-created instance with a random UUID).
 *
 * Rules:
 * - If stored active instance is a DIFFERENT worker's test instance → ignore, use our test instance
 * - If stored active instance is THIS worker's test instance → use it
 * - If stored active instance is a non-test instance (UUID) → use it (within-test state)
 * - If no stored active instance → use our test instance
 */
async function initializeTestInstance(
  testInstanceId: string
): Promise<InstanceMetadata> {
  const instances = await getInstances();

  // Ensure our worker's test instance exists
  let testInstance = instances.find((inst) => inst.id === testInstanceId);

  if (!testInstance) {
    const now = Date.now();
    testInstance = {
      id: testInstanceId,
      name: `Test Worker ${testInstanceId.replace('test-worker-', '')}`,
      createdAt: now,
      lastAccessedAt: now
    };
    instances.push(testInstance);
    await setInStore(REGISTRY_KEY, instances);
  }

  // Check if there's a stored active instance we should respect
  const storedActiveId = await getActiveInstanceId();

  if (storedActiveId) {
    const activeExists = instances.some((inst) => inst.id === storedActiveId);

    if (activeExists) {
      // If the stored active instance is a test instance from a DIFFERENT worker,
      // ignore it to maintain parallel isolation
      if (isTestInstance(storedActiveId) && storedActiveId !== testInstanceId) {
        // Different worker's test instance - override with our own
        await setActiveInstanceId(testInstanceId);
        return testInstance;
      }

      // Stored instance is either our test instance OR a non-test instance (UUID).
      // Respect it to preserve within-test state (e.g., user-created instances).
      const activeInstance = instances.find(
        (inst) => inst.id === storedActiveId
      );
      if (activeInstance) {
        return activeInstance;
      }
    }
  }

  // No valid stored active instance - use our test instance
  await setActiveInstanceId(testInstanceId);
  return testInstance;
}

/**
 * Clear the entire registry (for testing or complete reset).
 * Also resets the initialization lock so subsequent calls to
 * initializeRegistry() will properly re-initialize.
 */
export async function clearRegistry(): Promise<void> {
  // Reset initialization lock so next initializeRegistry() call works correctly
  resetInitializationState();

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
