import type { DomainScope } from "../../data/domainScope";
import { getCachedContainerWriterProjection } from "../../workflows/container-contents/container-state/projectionCache";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { emptyTrash } from "./emptyTrashOperation";
import {
  prepareContainerGroupRewrap,
  verifyContainerGroupRewrapCurrent,
} from "./groupRewrapOperation";
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
import { purgeContainer } from "./purgeContainerOperation";
import { setContainerIcon } from "./setContainerIconOperation";
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
  requestDocumentPriming: () => void;
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
    requestDocumentPriming: () => {
      state.documentStoresNeedPriming = true;
    },
    updateSnapshot: () => updateContainerContentsSnapshot(state),
  };
}

function chainContainerWrite(
  state: ContainerContentsStoreState,
  work: () => ContainerContentsStoreState["writeChain"],
): ContainerContentsStoreState["writeChain"] {
  state.writeChain = state.writeChain.catch(() => null).then(work);
  return state.writeChain;
}

function chainNodePresenceWrite(
  state: ContainerContentsStoreState,
  work: () => ContainerContentsStoreState["writeChain"],
): Promise<boolean> {
  return chainContainerWrite(state, work).then((node) => node !== null);
}

function chainContainerTask<T>(
  state: ContainerContentsStoreState,
  work: () => Promise<T>,
): Promise<T> {
  const task = state.writeChain.catch(() => null).then(work);
  state.writeChain = task.then(() => null);
  return task;
}

function chainPurgeWrite(
  state: ContainerContentsStoreState,
  work: () => Promise<boolean>,
): Promise<boolean> {
  const purged = state.writeChain.catch(() => null).then(work);
  state.writeChain = purged.then(() => null);
  return purged;
}

type ContainerWriteMethods = Pick<
  ContainerContentsStore,
  | "createChild"
  | "deleteContainer"
  | "emptyTrash"
  | "ensureSystemContainer"
  | "moveContainer"
  | "prepareGroupRewrap"
  | "purgeContainer"
  | "renameContainer"
  | "setContainerIcon"
  | "shareWithGroup"
  | "shareWithUser"
>;

// The group-rewrap builder verifies any required existing grant before capturing
// the container KEK, then returns a check/rewrap pair. A verified non-match is
// distinct from an unavailable preparation so security-critical callers can
// no-op unrelated groups without failing open for a real grant.
function createPrepareGroupRewrapMethod(
  state: ContainerContentsStoreState,
  syncAgent: ReturnType<typeof createContainerContentsStoreSyncAgent>,
): ContainerContentsStore["prepareGroupRewrap"] {
  return async (containerId, groupId, accessLevel, options) => {
    const preparation = await chainContainerTask(state, () =>
      prepareContainerGroupRewrap(
        state,
        containerId,
        groupId,
        accessLevel,
        options,
      ),
    );
    return preparation?.status === "prepared"
      ? {
          isCurrent: (
            expectedGroupHead,
            expectedContainerId,
            expectedOrganizationId,
          ) =>
            chainContainerTask(state, () =>
              verifyContainerGroupRewrapCurrent(
                state,
                containerId,
                groupId,
                accessLevel,
                expectedGroupHead,
                expectedContainerId,
                expectedOrganizationId,
              ),
            ),
          rewrap: () =>
            chainNodePresenceWrite(state, () =>
              shareContainerWithGroup(
                state,
                syncAgent,
                containerId,
                groupId,
                accessLevel,
                {
                  ...options,
                  knownContainerKeks: preparation.knownContainerKeks,
                },
              ),
            ),
          status: "prepared" as const,
        }
      : (preparation ?? null);
  };
}

function createContainerWriteMethods(
  state: ContainerContentsStoreState,
  syncAgent: ReturnType<typeof createContainerContentsStoreSyncAgent>,
): ContainerWriteMethods {
  return {
    createChild: (parentId, name) =>
      chainContainerWrite(state, () =>
        createChildContainer(state, syncAgent, parentId, name),
      ),
    deleteContainer: (containerId) =>
      chainNodePresenceWrite(state, () =>
        deleteContainer(state, syncAgent, containerId),
      ),
    purgeContainer: (containerId, options) =>
      chainPurgeWrite(state, () => purgeContainer(state, containerId, options)),
    emptyTrash: (trashContainerId, options) =>
      chainPurgeWrite(state, () =>
        emptyTrash(state, trashContainerId, options),
      ),
    ensureSystemContainer: (systemSlot, name, options) =>
      chainContainerWrite(state, () =>
        ensureSystemContainer(state, syncAgent, systemSlot, name, options),
      ),
    moveContainer: (containerId, parentId) =>
      chainContainerWrite(state, () =>
        moveContainer(state, syncAgent, containerId, parentId),
      ),
    prepareGroupRewrap: createPrepareGroupRewrapMethod(state, syncAgent),
    renameContainer: (containerId, name) =>
      chainContainerWrite(state, () =>
        renameContainer(state, syncAgent, containerId, name),
      ),
    setContainerIcon: (containerId, icon) =>
      chainContainerWrite(state, () =>
        setContainerIcon(state, syncAgent, containerId, icon),
      ),
    shareWithUser: (containerId, userId) =>
      chainNodePresenceWrite(state, () =>
        shareContainerWithUser(state, syncAgent, containerId, userId),
      ),
    shareWithGroup: (containerId, groupId, accessLevel, options) =>
      chainNodePresenceWrite(state, () =>
        shareContainerWithGroup(
          state,
          syncAgent,
          containerId,
          groupId,
          accessLevel,
          options,
        ),
      ),
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
  const writeMethods = createContainerWriteMethods(state, syncAgent);

  return {
    requestDocumentPriming: () => {
      state.documentStoresNeedPriming = true;
      syncAgent.scheduleSync();
    },
    store: {
      createChild: writeMethods.createChild,
      deleteContainer: writeMethods.deleteContainer,
      emptyTrash: writeMethods.emptyTrash,
      purgeContainer: writeMethods.purgeContainer,
      ensureSystemContainer: writeMethods.ensureSystemContainer,
      moveContainer: writeMethods.moveContainer,
      prepareGroupRewrap: writeMethods.prepareGroupRewrap,
      refresh: () => syncAgent.refresh(),
      refreshRootLane: (options) => syncAgent.refreshRootLane(options),
      // Force an on-demand local SQLite re-read (see the interface doc): arm the
      // gate refreshLocalContainerStates otherwise requires, which the runtime
      // auto-arms only on a context transition an on-demand caller cannot rely on.
      refreshLocalContainers: () => {
        state.localContainersNeedRefresh = true;
        return syncAgent.refreshLocalContainers();
      },
      requestSync: () => syncAgent.scheduleSync(),
      renameContainer: writeMethods.renameContainer,
      setContainerIcon: writeMethods.setContainerIcon,
      shareWithUser: writeMethods.shareWithUser,
      shareWithGroup: writeMethods.shareWithGroup,
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

/**
 * Arm the next structural pass's document-priming scan for a domain scope.
 * Priming normally re-arms only on store creation and topology changes, so a
 * caller that just tore down a document's local state uses this to have the
 * still-listed server document re-created without waiting for an app
 * restart. Returns false when the scope has no container-contents store yet;
 * the startup priming pass covers that case.
 */
export function requestContainerContentsDocumentPriming(
  domainScope: DomainScope,
): boolean {
  const entry = containerContentsStoresByScope.get(domainScope);
  if (!entry) {
    return false;
  }

  entry.requestDocumentPriming();
  return true;
}
