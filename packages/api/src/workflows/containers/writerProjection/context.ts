import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { AnyVerifiedPrincipalPolicy } from "@symcrypt/crypto";
import type { ContainerWriterProjectionContext } from "./types";

export function createContainerWriterProjectionContext(
  executor: DatabaseSession,
  principalPolicyAuthorizationEvidence: readonly AnyVerifiedPrincipalPolicy[] = [],
): ContainerWriterProjectionContext {
  return {
    containerKekStateByCacheKey: new Map(),
    containerPathRowById: new Map(),
    executor,
    currentManifestBundleByContainerId: new Map(),
    manifestBundleByHash: new Map(),
    principalPolicyAuthorizationEvidence,
    verifiedManifestByHash: new Map(),
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
