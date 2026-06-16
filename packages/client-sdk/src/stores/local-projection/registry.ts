import type { DomainScope } from "../../data/domainScope";
import {
  type ContainerContentsStoreOptions,
  getOrCreateContainerContentsStore,
} from "../container-contents";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import {
  createLocalProjectionStore,
  type LocalProjectionStore,
} from "./localProjectionStore";

const localProjectionStoresByScope = new WeakMap<
  DomainScope,
  LocalProjectionStore
>();

/**
 * Get (or lazily create) the device-first local projection store for a domain
 * scope. The store is cached per scope so every consumer in the same
 * storage/identity context shares one view — mirroring how the container
 * contents store is cached.
 */
export function getOrCreateLocalProjectionStore(input: {
  domainScope: DomainScope;
  runtime: ContainerContentsStoreRuntime;
  options?: ContainerContentsStoreOptions | undefined;
}): LocalProjectionStore {
  const existing = localProjectionStoresByScope.get(input.domainScope);
  if (existing) {
    existing.updateRuntime(input.runtime);
    return existing;
  }

  const containerStore = getOrCreateContainerContentsStore(
    input.domainScope,
    input.runtime,
    input.options ?? {},
  );
  const store = createLocalProjectionStore({
    containerStore,
    runtime: input.runtime,
  });
  localProjectionStoresByScope.set(input.domainScope, store);
  return store;
}
