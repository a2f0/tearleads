import type { DomainScope } from "../../data/domainScope";
import { getCachedContainerWriterProjection } from "../../workflows/container-contents/container-state/projectionCache";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import {
  createChildContainer,
  deleteContainer,
  ensureSystemContainer,
  moveContainer,
  persistContainerState,
  renameContainer,
  shareContainerWithGroup,
  shareContainerWithUser,
} from "./operations";
import {
  createContainerContentsStoreState,
  subscribeToContainerContentsStore,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import {
  type ContainerContentsStoreRuntime,
  createContainerContentsStoreSyncAgent,
} from "./syncAgent";
import type {
  ContainerContentsStore,
  ContainerContentsStoreOptions,
  ContainerContentsStoreState,
} from "./types";

const containerContentsStoresByScope = new WeakMap<
  DomainScope,
  ContainerContentsStoreEntry
>();

interface ContainerContentsStoreEntry {
  store: ContainerContentsStore;
  updateOptions: (options: ContainerContentsStoreOptions) => void;
}

function applyContainerContentsStoreOptions(
  state: ContainerContentsStoreState,
  options: ContainerContentsStoreOptions,
): void {
  if ("logLabel" in options) {
    state.logLabel = options.logLabel;
  }

  if ("persistence" in options) {
    state.persistence =
      options.persistence ?? defaultContainerContentsPersistence;
  }
}

function getCachedContainerWriterProjectionForStore(
  state: ContainerContentsStoreState,
  containerId: string,
) {
  const containerState = state.containersById.get(containerId);
  return containerState
    ? getCachedContainerWriterProjection(containerState)
    : null;
}

function createContainerContentsStoreSyncHost(
  state: ContainerContentsStoreState,
): Parameters<typeof createContainerContentsStoreSyncAgent>[0]["host"] {
  return {
    persistContainerState: (containerState, patch, updateView, saveOptions) =>
      persistContainerState(
        state,
        containerState,
        patch,
        updateView,
        saveOptions,
      ),
    updateSnapshot: () => updateContainerContentsSnapshot(state),
  };
}

function createContainerContentsStoreEntry(
  initialRuntime: ContainerContentsStoreRuntime,
  persistence: ContainerContentsPersistence = defaultContainerContentsPersistence,
  options: ContainerContentsStoreOptions = {},
): ContainerContentsStoreEntry {
  const state = createContainerContentsStoreState(
    initialRuntime,
    options.persistence ?? persistence,
    options.logLabel,
  );
  const syncAgent = createContainerContentsStoreSyncAgent({
    host: createContainerContentsStoreSyncHost(state),
    state,
  });

  return {
    store: {
      createChild: (parentId: string, name: string) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() => createChildContainer(state, syncAgent, parentId, name));
        return state.writeChain;
      },
      deleteContainer: (containerId: string) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() => deleteContainer(state, containerId));
        return state.writeChain.then((deletedNode) => deletedNode !== null);
      },
      ensureSystemContainer: (systemSlot, name, options) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() =>
            ensureSystemContainer(state, syncAgent, systemSlot, name, options),
          );
        return state.writeChain;
      },
      moveContainer: (containerId: string, parentId: string) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() => moveContainer(state, syncAgent, containerId, parentId));
        return state.writeChain;
      },
      refresh: () => syncAgent.refresh(),
      renameContainer: (containerId: string, name: string) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() => renameContainer(state, syncAgent, containerId, name));
        return state.writeChain;
      },
      shareWithUser: (containerId: string, userId: string) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() =>
            shareContainerWithUser(state, syncAgent, containerId, userId),
          );
        return state.writeChain.then((sharedNode) => sharedNode !== null);
      },
      shareWithGroup: (containerId, groupId, accessLevel) => {
        state.writeChain = state.writeChain
          .catch(() => null)
          .then(() =>
            shareContainerWithGroup(
              state,
              syncAgent,
              containerId,
              groupId,
              accessLevel,
            ),
          );
        return state.writeChain.then((sharedNode) => sharedNode !== null);
      },
      getCachedContainerWriterProjection: (containerId) =>
        getCachedContainerWriterProjectionForStore(state, containerId),
      getSnapshot: () => state.snapshot,
      subscribe: (listener) =>
        subscribeToContainerContentsStore(state, listener),
      updateRuntime: (runtime) =>
        updateContainerContentsStoreRuntime(state, runtime, syncAgent),
    },
    updateOptions: (nextOptions) =>
      applyContainerContentsStoreOptions(state, nextOptions),
  };
}

export function createContainerContentsStore(
  initialRuntime: ContainerContentsStoreRuntime,
  persistence: ContainerContentsPersistence = defaultContainerContentsPersistence,
  options: ContainerContentsStoreOptions = {},
): ContainerContentsStore {
  return createContainerContentsStoreEntry(initialRuntime, persistence, options)
    .store;
}

export function getOrCreateContainerContentsStore(
  domainScope: DomainScope,
  runtime: ContainerContentsStoreRuntime,
  options: ContainerContentsStoreOptions = {},
): ContainerContentsStore {
  const existingEntry = containerContentsStoresByScope.get(domainScope);
  if (existingEntry) {
    existingEntry.updateOptions(options);
    return existingEntry.store;
  }

  const nextEntry = createContainerContentsStoreEntry(
    runtime,
    defaultContainerContentsPersistence,
    options,
  );
  containerContentsStoresByScope.set(domainScope, nextEntry);
  return nextEntry.store;
}
