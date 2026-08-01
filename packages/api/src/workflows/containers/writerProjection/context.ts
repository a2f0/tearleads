import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  ContainerKekHistoryObservation,
  ContainerKekHistoryObserver,
  ContainerWriterProjectionContext,
} from "./types";

const LONG_PREDECESSOR_CHAIN_WARNING_THRESHOLD = 8;

function observeContainerKekHistory(
  observation: ContainerKekHistoryObservation,
): void {
  if (observation.degradationReason !== null) {
    console.warn("Container KEK predecessor history degraded", observation);
    return;
  }
  if (
    observation.predecessorCount >= LONG_PREDECESSOR_CHAIN_WARNING_THRESHOLD
  ) {
    console.warn("Container KEK predecessor chain is long", observation);
  }
}

export function createContainerWriterProjectionContext(
  executor: DatabaseSession,
  options: {
    readonly observeContainerKekHistory?: ContainerKekHistoryObserver;
  } = {},
): ContainerWriterProjectionContext {
  return {
    containerKekStateByCacheKey: new Map(),
    containerPathRowById: new Map(),
    executor,
    currentManifestBundleByContainerId: new Map(),
    manifestBundleByHash: new Map(),
    observeContainerKekHistory:
      options.observeContainerKekHistory ?? observeContainerKekHistory,
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
