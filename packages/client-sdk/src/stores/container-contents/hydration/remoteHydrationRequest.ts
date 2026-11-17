import {
  createGenerationGuardedHydrationHost,
  hydrateRemoteContainers,
  type RemoteContainerHydrationHost,
  StaleRemoteHydrationError,
} from "../../../workflows/container-contents/remoteHydration";
import type { RemoteContainerHydrationState } from "../../../workflows/container-contents/remoteHydration/types";
import { isDatabaseUnavailableError } from "../../../workflows/container-contents/syncLane";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "../localRefresh";
import {
  IDLE_RECOVERY_HYDRATION,
  type RecoveryHydrationEvent,
  type RecoveryHydrationState,
  transitionRecoveryHydration,
} from "./recoveryHydrationMachine";

type RemoteHydrationRequestState = RemoteContainerHydrationState &
  LocalContainerRefreshState & {
    containerParentIdsNeedingHydration: Set<string | null>;
    initializePromise: Promise<void> | null;
    lifecycleGeneration: number;
    remoteHydrationGeneration: number | null;
    remoteHydrationPromise: Promise<void> | null;
    remoteHydrationStructuralGeneration: number | null;
    rootLaneHydrated: boolean;
    snapshot: {
      ready: boolean;
    };
    structuralGeneration: number;
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
  structuralGeneration: number;
}

function isRequestGenerationCurrent(input: {
  lifecycleGeneration: number;
  state: RemoteHydrationRequestState;
  structuralGeneration: number;
}): boolean {
  return (
    input.state.lifecycleGeneration === input.lifecycleGeneration &&
    input.state.structuralGeneration === input.structuralGeneration
  );
}

const recoveryHydrationByState = new WeakMap<
  RemoteHydrationRequestState,
  RecoveryHydrationState<RecoveryHydrationRequest>
>();

function dispatchRecoveryHydration(
  state: RemoteHydrationRequestState,
  event: RecoveryHydrationEvent<RecoveryHydrationRequest>,
): void {
  const next = transitionRecoveryHydration(
    recoveryHydrationByState.get(state) ?? IDLE_RECOVERY_HYDRATION,
    event,
  );
  if (next.status === "idle") {
    recoveryHydrationByState.delete(state);
  } else {
    recoveryHydrationByState.set(state, next);
  }
}

function queueRecoveryHydrationRequest(
  input: RemoteHydrationRequestInput,
): void {
  dispatchRecoveryHydration(input.state, {
    request: {
      input,
      lifecycleGeneration: input.state.lifecycleGeneration,
      structuralGeneration: input.state.structuralGeneration,
    },
    type: "queued",
  });
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
  const requestStructuralGeneration = state.structuralGeneration;
  const needsCurrentGenerationHydration =
    state.remoteHydrationGeneration !== state.lifecycleGeneration ||
    state.remoteHydrationStructuralGeneration !== state.structuralGeneration;
  const requestQueuedHydration = () => {
    if (
      !isRequestGenerationCurrent({
        lifecycleGeneration: requestLifecycleGeneration,
        state,
        structuralGeneration: requestStructuralGeneration,
      })
    ) {
      return retryRemoteHydrationAfterReset(input);
    }
    // Another request's crawl may have taken over this request's queued
    // lanes. Settle with that crawl rather than at once, so the request never
    // resolves before the listing that covers it.
    return needsCurrentGenerationHydration ||
      state.containerParentIdsNeedingHydration.size > 0
      ? requestContainerContentsRemoteHydration(input)
      : (state.remoteHydrationPromise ?? undefined);
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
  const requestStructuralGeneration = state.structuralGeneration;
  return activeInitialization.then(() => {
    const recoveryInput = isRequestGenerationCurrent({
      lifecycleGeneration: requestLifecycleGeneration,
      state,
      structuralGeneration: requestStructuralGeneration,
    })
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
  const recovery =
    recoveryHydrationByState.get(state) ?? IDLE_RECOVERY_HYDRATION;
  if (recovery.status === "idle") return null;
  // Another caller already took this caller's queued request over.
  if (recovery.status === "running") return recovery.run;
  const inputs = recovery.requests.map((request) =>
    isRequestGenerationCurrent({
      lifecycleGeneration: request.lifecycleGeneration,
      state,
      structuralGeneration: request.structuralGeneration,
    })
      ? request.input
      : createResetRecoveryInput(request.input),
  );
  let resolveRun: () => void = () => undefined;
  let rejectRun: (error: unknown) => void = () => undefined;
  const run = new Promise<void>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  // The run is current before its requests start, so a request one of them
  // queues meanwhile waits for the next resume instead of being dropped.
  dispatchRecoveryHydration(state, { run, type: "started" });
  const settle = () =>
    dispatchRecoveryHydration(state, { run, type: "settled" });
  run.then(settle, settle);
  const fail = (error: unknown) => {
    for (const input of inputs) {
      queueRecoveryHydrationRequest(input);
    }
    rejectRun(error);
  };
  try {
    Promise.all(inputs.map(requestContainerContentsRemoteHydration)).then(
      () => resolveRun(),
      fail,
    );
  } catch (error) {
    fail(error);
  }
  return run;
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

function consumeQueuedHydrationScope(
  state: RemoteHydrationRequestState,
  followDiscoveredParentLanesOption: boolean | undefined,
): {
  followDiscoveredParentLanes: boolean;
  parentIds: ReadonlyArray<string | null> | undefined;
} {
  const queuedParentIds = Array.from(state.containerParentIdsNeedingHydration);
  const followDiscoveredParentLanes =
    followDiscoveredParentLanesOption ?? queuedParentIds.length === 0;
  state.containerParentIdsNeedingHydration.clear();
  return {
    followDiscoveredParentLanes,
    parentIds:
      followDiscoveredParentLanes || queuedParentIds.length === 0
        ? undefined
        : queuedParentIds,
  };
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

  const { followDiscoveredParentLanes, parentIds } =
    consumeQueuedHydrationScope(state, input.followDiscoveredParentLanes);

  let appliedRemoteContainerChange = false;
  let retainInterruptedHydration = false;
  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  const isCurrent = () =>
    isRequestGenerationCurrent({
      lifecycleGeneration,
      state,
      structuralGeneration,
    });
  const onFullyHydrated = input.recreateOnFullyHydratedAtStart
    ? input.recreateOnFullyHydratedAfterReset?.()
    : input.onFullyHydrated;
  const hydrationHost = createGenerationGuardedHydrationHost({
    host,
    isCurrent,
  });
  const rootLaneHydratedBeforeRequest = state.rootLaneHydrated;
  state.remoteHydrationGeneration = lifecycleGeneration;
  state.remoteHydrationStructuralGeneration = structuralGeneration;
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
        state.remoteHydrationStructuralGeneration = null;
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
