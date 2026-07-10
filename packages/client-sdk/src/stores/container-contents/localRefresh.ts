import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";

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
  const remoteContainerIdsAtLoadStart = new Set(
    Array.from(state.containersById.values()).flatMap((containerState) =>
      containerState.record.documentId ? [containerState.container.id] : [],
    ),
  );
  state.localContainerRefreshPromise = loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  })
    .then((localContainerStates) => {
      mergeLocalContainerStates({
        localContainerStates,
        remoteContainerIdsAtLoadStart,
        state,
      });
      state.documentStoresNeedPriming = true;
      host.updateSnapshot();
    })
    .catch((error: unknown) => {
      state.localContainersNeedRefresh = true;
      state.runtime.util.log(
        `Failed to refresh local container states: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => {
      state.localContainerRefreshPromise = null;
    });

  return state.localContainerRefreshPromise;
}
