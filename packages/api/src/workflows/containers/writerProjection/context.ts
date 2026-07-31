import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { ContainerWriterProjectionContext } from "./types";

export function createContainerWriterProjectionContext(
  executor: DatabaseSession,
): ContainerWriterProjectionContext {
  return {
    containerKekStateByCacheKey: new Map(),
    containerPathRowById: new Map(),
    executor,
    currentManifestBundleByContainerId: new Map(),
    manifestBundleByHash: new Map(),
    predecessorContainerKeksByEpochId: new Map(),
  };
}

export async function cachedProjectionValue<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cachedValue = cache.get(key);
  if (cachedValue) {
    return cachedValue;
  }

  const loadedValue = load();
  cache.set(key, loadedValue);

  try {
    return await loadedValue;
  } catch (error) {
    if (cache.get(key) === loadedValue) {
      cache.delete(key);
    }
    throw error;
  }
}
