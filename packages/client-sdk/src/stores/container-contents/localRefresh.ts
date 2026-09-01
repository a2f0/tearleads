import { encodeVersionVector } from "@tearleads/loro";
import { errorMessage } from "../../data/errorMessage";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { loadLocalContainerStates } from "../../workflows/container-contents/localState";
import { installContainerMetadataRecord } from "../../workflows/container-contents/metadata";
import { currentMetadataPullContinuation } from "../../workflows/container-contents/metadataPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { reconcileLocalOnlyRootContainers } from "../../workflows/container-contents/remoteHydration/reconciliation";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import {
  captureContainerStateMutationGenerations,
  containerStateMutatedAfter,
} from "./containerStateMap";
import { isRemoteBackedContainerState } from "./remoteBackedContainerState";

interface LocalContainerRefreshHost {
  updateSnapshot: () => void;
}

export interface LocalContainerRefreshState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initialized: boolean;
  lifecycleGeneration: number;
  localContainerRefreshGeneration: number | null;
  localContainerRefreshPromise: Promise<void> | null;
  localContainerRefreshStructuralGeneration: number | null;
  localContainersNeedRefresh: boolean;
  persistence: ContainerContentsPersistence;
  runtime: ContainerContentsWorkflowRuntime;
  structuralGeneration: number;
}

interface LocalContainerRefreshBaseline {
  container: ContainerState["container"];
  docVersion: string | null;
  pullContinuation: ReturnType<typeof currentMetadataPullContinuation>;
  record: ContainerState["record"];
}

function readMetadataDocVersion(state: ContainerState): string | null {
  try {
    return encodeVersionVector(state.doc);
  } catch {
    return null;
  }
}

function captureLocalContainerRefreshBaselines(
  states: ReadonlyMap<string, ContainerState>,
): ReadonlyMap<string, LocalContainerRefreshBaseline> {
  return new Map(
    Array.from(states, ([containerId, state]) => [
      containerId,
      {
        container: state.container,
        docVersion: readMetadataDocVersion(state),
        pullContinuation: currentMetadataPullContinuation(state),
        record: state.record,
      },
    ]),
  );
}

function liveContainerStateChangedAfterRefreshStarted(
  state: ContainerState,
  baseline: LocalContainerRefreshBaseline | undefined,
): boolean {
  // No baseline means this live state was inserted after the refresh began.
  // The loaded snapshot cannot authoritatively replace a state that did not
  // exist when its query started.
  return (
    baseline === undefined ||
    state.container !== baseline.container ||
    state.record !== baseline.record ||
    currentMetadataPullContinuation(state) !== baseline.pullContinuation ||
    readMetadataDocVersion(state) !== baseline.docVersion
  );
}

function mergeLocalContainerStates(input: {
  containerMutationGenerations: ReadonlyMap<string, number>;
  liveStateBaselines: ReadonlyMap<string, LocalContainerRefreshBaseline>;
  localContainerStates: ReadonlyArray<ContainerState>;
  remoteContainerIdsAtLoadStart: ReadonlySet<string>;
  state: LocalContainerRefreshState;
}): void {
  for (const localContainerState of input.localContainerStates) {
    const containerId = localContainerState.container.id;
    if (
      containerStateMutatedAfter(
        input.state.containersById,
        containerId,
        input.containerMutationGenerations,
      )
    ) {
      continue;
    }
    const existingState = input.state.containersById.get(containerId);
    if (existingState) {
      if (
        liveContainerStateChangedAfterRefreshStarted(
          existingState,
          input.liveStateBaselines.get(containerId),
        )
      ) {
        continue;
      }
      // The load can start before a remote create and finish after it. Its
      // local-only snapshot must not erase the remote identity that the create
      // persisted in the meantime, or the pending create intent is re-queued.
      if (
        !input.remoteContainerIdsAtLoadStart.has(containerId) &&
        existingState.record.documentId &&
        !localContainerState.record.documentId
      ) {
        continue;
      }
      existingState.container = localContainerState.container;
      existingState.doc = localContainerState.doc;
      installContainerMetadataRecord(existingState, localContainerState.record);
    } else if (!input.liveStateBaselines.has(containerId)) {
      // A baseline without a live entry means the state was removed while the
      // load was pending. Do not resurrect that stale snapshot.
      input.state.containersById.set(containerId, localContainerState);
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
  isCurrent: () => boolean,
): Promise<void> {
  const remoteRootStates = Array.from(state.containersById.values()).filter(
    isRemoteBackedRootState,
  );
  for (const remoteRootState of remoteRootStates) {
    if (!isCurrent()) {
      return;
    }
    await reconcileLocalOnlyRootContainers({
      isCurrent,
      remoteRootState,
      state,
    });
  }
}

export function refreshLocalContainerStates(input: {
  host: LocalContainerRefreshHost;
  state: LocalContainerRefreshState;
}): Promise<void> {
  const { host, state } = input;
  if (state.localContainerRefreshPromise) {
    const activeRefresh = state.localContainerRefreshPromise;
    if (
      state.localContainerRefreshGeneration === state.lifecycleGeneration &&
      state.localContainerRefreshStructuralGeneration ===
        state.structuralGeneration
    ) {
      return activeRefresh;
    }
    // A stale refresh owns its replacement retry in `finally`, so callers can
    // share that promise without scheduling a second replacement load.
    return activeRefresh;
  }

  if (
    !state.localContainersNeedRefresh ||
    !state.initialized ||
    state.runtime.infra.dbStatus !== "ready"
  ) {
    return Promise.resolve();
  }

  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  const isCurrent = () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.structuralGeneration === structuralGeneration;
  state.localContainersNeedRefresh = false;
  const liveStateBaselines = captureLocalContainerRefreshBaselines(
    state.containersById,
  );
  const containerMutationGenerations = captureContainerStateMutationGenerations(
    state.containersById,
  );
  const remoteContainerIdsAtLoadStart = new Set<string>();
  for (const containerState of state.containersById.values()) {
    if (containerState.record.documentId) {
      remoteContainerIdsAtLoadStart.add(containerState.container.id);
    }
  }
  state.localContainerRefreshGeneration = lifecycleGeneration;
  state.localContainerRefreshStructuralGeneration = structuralGeneration;
  const refreshPromise = loadLocalContainerStates({
    persistence: state.persistence,
    runtime: state.runtime,
  })
    .then(async (localContainerStates) => {
      if (!isCurrent()) {
        return;
      }
      mergeLocalContainerStates({
        containerMutationGenerations,
        liveStateBaselines,
        localContainerStates,
        remoteContainerIdsAtLoadStart,
        state,
      });
      // Remote hydration can win the startup race and ingest the server root
      // before this local read returns. Re-run root/system convergence after
      // merging so that the late local bootstrap rows cannot reintroduce a
      // stale root and same-slot system children into the live tree.
      await reconcileLocalsLoadedAfterRemoteState(state, isCurrent);
      if (!isCurrent()) {
        return;
      }
      state.documentStoresNeedPriming = true;
      host.updateSnapshot();
    })
    .catch((error: unknown) => {
      if (!isCurrent()) {
        return;
      }
      state.localContainersNeedRefresh = true;
      state.runtime.util.log(
        `Failed to refresh local container states: ${errorMessage(error)}`,
      );
    })
    .finally(() => {
      const shouldRetryAfterReplacement = !isCurrent();
      if (state.localContainerRefreshPromise === refreshPromise) {
        state.localContainerRefreshPromise = null;
        state.localContainerRefreshGeneration = null;
        state.localContainerRefreshStructuralGeneration = null;
      }
      if (shouldRetryAfterReplacement) {
        state.localContainersNeedRefresh = true;
        return refreshLocalContainerStates(input);
      }
      return undefined;
    });
  state.localContainerRefreshPromise = refreshPromise;

  return refreshPromise;
}
