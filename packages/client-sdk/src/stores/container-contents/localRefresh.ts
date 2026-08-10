import { errorMessage } from "../../data/errorMessage";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { reconcileLocalOnlyRootContainers } from "../../workflows/container-contents/remoteHydration/reconciliation";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { isRemoteBackedContainerState } from "./remoteBackedContainerState";

interface LocalContainerRefreshHost {
  updateSnapshot: () => void;
}

export interface LocalContainerRefreshState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initialized: boolean;
  localContainerRefreshPromise: Promise<void> | null;
  localContainersNeedRefresh: boolean;
  persistence: ContainerContentsPersistence;
  runtime: ContainerContentsWorkflowRuntime;
}

function mergeLocalContainerStates(input: {
  localContainerStates: ReadonlyArray<ContainerState>;
  remoteContainerIdsAtLoadStart: ReadonlySet<string>;
  state: LocalContainerRefreshState;
}): void {
  for (const localContainerState of input.localContainerStates) {
    const existingState = input.state.containersById.get(
      localContainerState.container.id,
    );
    if (existingState) {
      // The load can start before a remote create and finish after it. Its
      // local-only snapshot must not erase the remote identity that the create
      // persisted in the meantime, or the pending create intent is re-queued.
      if (
        !input.remoteContainerIdsAtLoadStart.has(
          localContainerState.container.id,
        ) &&
        existingState.record.documentId &&
        !localContainerState.record.documentId
      ) {
        continue;
      }
      existingState.container = localContainerState.container;
      existingState.doc = localContainerState.doc;
      existingState.record = localContainerState.record;
    } else {
      input.state.containersById.set(
        localContainerState.container.id,
        localContainerState,
      );
    }
  }
}

function isRemoteBackedRootState(containerState: ContainerState): boolean {
  return (
    containerState.container.parentId === null &&
    isRemoteBackedContainerState(containerState)
  );
}

async function reconcileLocalsLoadedAfterRemoteState(
  state: LocalContainerRefreshState,
): Promise<void> {
  const remoteRootStates = Array.from(state.containersById.values()).filter(
    isRemoteBackedRootState,
  );
  for (const remoteRootState of remoteRootStates) {
    await reconcileLocalOnlyRootContainers({ remoteRootState, state });
  }
}

export function refreshLocalContainerStates(input: {
  host: LocalContainerRefreshHost;
  state: LocalContainerRefreshState;
}): Promise<void> {
  const { host, state } = input;
  if (state.localContainerRefreshPromise) {
    return state.localContainerRefreshPromise;
  }

  if (
    !state.localContainersNeedRefresh ||
    !state.initialized ||
    state.runtime.infra.dbStatus !== "ready"
  ) {
    return Promise.resolve();
  }

  state.localContainersNeedRefresh = false;
  const remoteContainerIdsAtLoadStart = new Set<string>();
  for (const containerState of state.containersById.values()) {
    if (containerState.record.documentId) {
      remoteContainerIdsAtLoadStart.add(containerState.container.id);
    }
  }
  state.localContainerRefreshPromise = loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  })
    .then(async (localContainerStates) => {
      mergeLocalContainerStates({
        localContainerStates,
        remoteContainerIdsAtLoadStart,
        state,
      });
      // Remote hydration can win the startup race and ingest the server root
      // before this local read returns. Re-run root/system convergence after
      // merging so that the late local bootstrap rows cannot reintroduce a
      // stale root and same-slot system children into the live tree.
      await reconcileLocalsLoadedAfterRemoteState(state);
      state.documentStoresNeedPriming = true;
      host.updateSnapshot();
    })
    .catch((error: unknown) => {
      state.localContainersNeedRefresh = true;
      state.runtime.util.log(
        `Failed to refresh local container states: ${errorMessage(error)}`,
      );
    })
    .finally(() => {
      state.localContainerRefreshPromise = null;
    });

  return state.localContainerRefreshPromise;
}
