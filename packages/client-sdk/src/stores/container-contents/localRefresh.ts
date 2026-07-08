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
  state: LocalContainerRefreshState;
}): void {
  for (const localContainerState of input.localContainerStates) {
    const existingState = input.state.containersById.get(
      localContainerState.container.id,
    );
    if (existingState) {
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
  state.localContainerRefreshPromise = loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  })
    .then((localContainerStates) => {
      mergeLocalContainerStates({ localContainerStates, state });
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
