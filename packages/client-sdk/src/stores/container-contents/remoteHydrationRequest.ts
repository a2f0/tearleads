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
  recreateOnFullyHydratedAfterReset?:
    | (() => () => Promise<void> | void)
    | undefined;
  recreateOnFullyHydratedAtStart?: boolean | undefined;
  resumeRecoveryWork: () => Promise<void>;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSyncOnHydrationChange?: boolean | undefined;
  scheduleSync: () => void;
  state: RemoteHydrationRequestState;
}

interface RecoveryHydrationRequest {
  input: RemoteHydrationRequestInput;
  lifecycleGeneration: number;
}

const recoveryHydrationRequestsByState = new WeakMap<
  RemoteHydrationRequestState,
  RecoveryHydrationRequest[]
>();
function queueRecoveryHydrationRequest(
  input: RemoteHydrationRequestInput,
): void {
  const requests = recoveryHydrationRequestsByState.get(input.state);
  if (requests) {
    if (!requests.some((request) => request.input === input)) {
      requests.push({
        input,
        lifecycleGeneration: input.state.lifecycleGeneration,
      });
    }
    return;
  }
  recoveryHydrationRequestsByState.set(input.state, [
    { input, lifecycleGeneration: input.state.lifecycleGeneration },
  ]);
}

function hasRemoteHydrationPrerequisites(
  state: RemoteHydrationRequestState,
): boolean {
  return (
    state.runtime.infra.dbStatus === "ready" &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online
  );
}

function createResetRecoveryInput(
  input: RemoteHydrationRequestInput,
): RemoteHydrationRequestInput {
  return {
    ...input,
    followDiscoveredParentLanes: true,
    onFullyHydrated: undefined,
    parentIds: undefined,
    recreateOnFullyHydratedAtStart: true,
  };
}

function resumeRetainedRecoveryHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  queueRecoveryHydrationRequest(input);
  return hasRemoteHydrationPrerequisites(input.state)
    ? input.resumeRecoveryWork()
    : Promise.resolve();
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
  const requestQueuedHydration = () => {
    if (requestLifecycleGeneration !== state.lifecycleGeneration) {
      return retryRemoteHydrationAfterReset(input);
    }
    return needsCurrentGenerationHydration ||
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
  const { state } = input;
  const activeInitialization = state.initializePromise;
  if (!activeInitialization) {
    return null;
  }
  const requestLifecycleGeneration = state.lifecycleGeneration;
  return activeInitialization.then(() => {
    const recoveryInput =
      requestLifecycleGeneration === state.lifecycleGeneration
        ? input
        : createResetRecoveryInput(input);
    return resumeRetainedRecoveryHydration(recoveryInput);
  });
}

function retryRemoteHydrationAfterReset(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  return resumeRetainedRecoveryHydration(createResetRecoveryInput(input));
}

function retainResetRecoveryHydration(
  input: RemoteHydrationRequestInput,
): void {
  queueRecoveryHydrationRequest(createResetRecoveryInput(input));
}

export function resumeContainerContentsRecoveryHydration(
  state: RemoteHydrationRequestState,
): Promise<void> | null {
  const requests = recoveryHydrationRequestsByState.get(state);
  if (!requests) {
    return null;
  }
  recoveryHydrationRequestsByState.delete(state);
  const inputs = requests.map((request) =>
    request.lifecycleGeneration === state.lifecycleGeneration
      ? request.input
      : createResetRecoveryInput(request.input),
  );
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
  if (!hasRemoteHydrationPrerequisites(input.state)) {
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
  let retainInterruptedHydration = false;
  const lifecycleGeneration = state.lifecycleGeneration;
  const isCurrent = () => state.lifecycleGeneration === lifecycleGeneration;
  const onFullyHydrated = input.recreateOnFullyHydratedAtStart
    ? input.recreateOnFullyHydratedAfterReset?.()
    : input.onFullyHydrated;
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
        onFullyHydrated,
        parentIds,
        resetAllLaneWatermarks: input.resetAllLaneWatermarks,
        resetRootLaneWatermark: input.resetRootLaneWatermark,
        state,
      });
    })
    .then((changedCount) => {
      appliedRemoteContainerChange = changedCount > 0;
      if (isCurrent() && !hasRemoteHydrationPrerequisites(state)) {
        retainInterruptedHydration = true;
      }
    })
    .catch((error: unknown) => {
      if (isCurrent() && isDatabaseUnavailableError(error)) {
        retainInterruptedHydration = true;
        return;
      }
      if (!isCurrent() || error instanceof StaleRemoteHydrationError) {
        return;
      }

      throw error;
    })
    .finally(() => {
      const shouldRetryAfterReset = !isCurrent();
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
      if (retainInterruptedHydration) {
        retainResetRecoveryHydration(input);
      }
      return undefined;
    });
  state.remoteHydrationPromise = hydrationPromise;

  return hydrationPromise;
}
