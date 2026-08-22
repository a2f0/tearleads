import {
  createGenerationGuardedHydrationHost,
  hydrateRemoteContainers,
  type RemoteContainerHydrationHost,
  StaleRemoteHydrationError,
} from "../../workflows/container-contents/remoteHydration";
import type { RemoteContainerHydrationState } from "../../workflows/container-contents/remoteHydration/types";
import { isDatabaseUnavailableError } from "../../workflows/container-contents/syncLane";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "./localRefresh";

type RemoteHydrationRequestState = RemoteContainerHydrationState &
  LocalContainerRefreshState & {
    containerParentIdsNeedingHydration: Set<string | null>;
    initializePromise: Promise<void> | null;
    lifecycleGeneration: number;
    remoteHydrationGeneration: number | null;
    remoteHydrationPromise: Promise<void> | null;
    rootLaneHydrated: boolean;
    snapshot: {
      ready: boolean;
    };
  };

interface RemoteHydrationRequestInput {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSyncOnHydrationChange?: boolean | undefined;
  scheduleSync: () => void;
  state: RemoteHydrationRequestState;
}

const recoveryHydrationRequestsByState = new WeakMap<
  RemoteHydrationRequestState,
  RemoteHydrationRequestInput[]
>();
const statesWithQueuedHydrationRequest =
  new WeakSet<RemoteHydrationRequestState>();

function queueRecoveryHydrationRequest(
  input: RemoteHydrationRequestInput,
): void {
  const requests = recoveryHydrationRequestsByState.get(input.state);
  if (requests) {
    requests.push(input);
    return;
  }
  recoveryHydrationRequestsByState.set(input.state, [input]);
}

function waitForActiveRemoteHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> | null {
  const { state } = input;
  const activeHydration = state.remoteHydrationPromise;
  if (!activeHydration) {
    return null;
  }
  const requestLifecycleGeneration = state.lifecycleGeneration;
  const needsCurrentGenerationHydration =
    state.remoteHydrationGeneration !== state.lifecycleGeneration;
  statesWithQueuedHydrationRequest.add(state);
  const requestQueuedHydration = () => {
    statesWithQueuedHydrationRequest.delete(state);
    return requestLifecycleGeneration !== state.lifecycleGeneration ||
      needsCurrentGenerationHydration ||
      state.containerParentIdsNeedingHydration.size > 0
      ? requestContainerContentsRemoteHydration(input)
      : undefined;
  };
  return activeHydration.then(
    requestQueuedHydration,
    (error: unknown) => requestQueuedHydration() ?? Promise.reject(error),
  );
}

function waitForActiveInitialization(
  input: RemoteHydrationRequestInput,
): Promise<void> | null {
  const activeInitialization = input.state.initializePromise;
  if (!activeInitialization) {
    return null;
  }
  return activeInitialization.then(() =>
    requestContainerContentsRemoteHydration(input),
  );
}

function retryRemoteHydrationAfterReset(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  const retryInput = { ...input, onFullyHydrated: undefined };
  if (retryInput.state.runtime.infra.dbStatus !== "ready") {
    queueRecoveryHydrationRequest(retryInput);
    return Promise.resolve();
  }
  return requestContainerContentsRemoteHydration(retryInput);
}

export function resumeContainerContentsRecoveryHydration(
  state: RemoteHydrationRequestState,
): Promise<void> | null {
  const inputs = recoveryHydrationRequestsByState.get(state);
  if (!inputs) {
    return null;
  }
  recoveryHydrationRequestsByState.delete(state);
  return Promise.all(inputs.map(requestContainerContentsRemoteHydration))
    .then(() => undefined)
    .catch((error: unknown) => {
      for (const input of inputs) {
        queueRecoveryHydrationRequest(input);
      }
      throw error;
    });
}

function queueRequestedParentIds(input: RemoteHydrationRequestInput): void {
  if (!input.parentIds) {
    return;
  }
  for (const parentId of input.parentIds) {
    input.state.containerParentIdsNeedingHydration.add(parentId);
  }
}

function waitForRemoteHydrationReadiness(
  input: RemoteHydrationRequestInput,
): Promise<void> | null {
  const activeHydration = waitForActiveRemoteHydration(input);
  if (activeHydration) {
    return activeHydration;
  }
  const activeInitialization = waitForActiveInitialization(input);
  if (activeInitialization) {
    return activeInitialization;
  }
  if (input.state.runtime.infra.dbStatus !== "ready") {
    queueRecoveryHydrationRequest(input);
    return Promise.resolve();
  }
  return null;
}

export function requestContainerContentsRemoteHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  const { host, scheduleSync, state } = input;
  queueRequestedParentIds(input);
  const readinessBarrier = waitForRemoteHydrationReadiness(input);
  if (readinessBarrier) {
    return readinessBarrier;
  }

  const queuedParentIds = Array.from(state.containerParentIdsNeedingHydration);
  const followDiscoveredParentLanes =
    input.followDiscoveredParentLanes ?? queuedParentIds.length === 0;
  const parentIds = followDiscoveredParentLanes
    ? undefined
    : queuedParentIds.length === 0
      ? undefined
      : queuedParentIds;
  state.containerParentIdsNeedingHydration.clear();

  let appliedRemoteContainerChange = false;
  const lifecycleGeneration = state.lifecycleGeneration;
  const isCurrent = () => state.lifecycleGeneration === lifecycleGeneration;
  const hydrationHost = createGenerationGuardedHydrationHost({
    host,
    isCurrent,
  });
  const rootLaneHydratedBeforeRequest = state.rootLaneHydrated;
  state.remoteHydrationGeneration = lifecycleGeneration;
  const hydrationPromise = refreshLocalContainerStates({
    host: hydrationHost,
    state,
  })
    .then(() => {
      if (!isCurrent()) {
        return 0;
      }
      return hydrateRemoteContainers({
        followDiscoveredParentLanes,
        host: hydrationHost,
        isCurrent,
        onFullyHydrated: input.onFullyHydrated,
        parentIds,
        resetAllLaneWatermarks: input.resetAllLaneWatermarks,
        resetRootLaneWatermark: input.resetRootLaneWatermark,
        state,
      });
    })
    .then((changedCount) => {
      appliedRemoteContainerChange = changedCount > 0;
    })
    .catch((error: unknown) => {
      if (
        !isCurrent() ||
        error instanceof StaleRemoteHydrationError ||
        isDatabaseUnavailableError(error)
      ) {
        return;
      }

      throw error;
    })
    .finally(() => {
      const shouldRetryAfterReset =
        !isCurrent() && !statesWithQueuedHydrationRequest.has(state);
      if (state.remoteHydrationPromise === hydrationPromise) {
        state.remoteHydrationPromise = null;
        state.remoteHydrationGeneration = null;
      }

      if (
        isCurrent() &&
        (((input.scheduleSyncOnHydrationChange ?? true) &&
          (appliedRemoteContainerChange ||
            (!rootLaneHydratedBeforeRequest && state.rootLaneHydrated))) ||
          input.scheduleSyncAfterHydration) &&
        state.snapshot.ready &&
        state.runtime.auth.isAuthenticated &&
        state.runtime.state.online
      ) {
        scheduleSync();
      }
      if (shouldRetryAfterReset) {
        return retryRemoteHydrationAfterReset(input);
      }
      return undefined;
    });
  state.remoteHydrationPromise = hydrationPromise;

  return hydrationPromise;
}
