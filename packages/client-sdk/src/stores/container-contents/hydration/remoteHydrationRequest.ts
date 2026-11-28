import {
  createGenerationGuardedHydrationHost,
  hydrateRemoteContainers,
  StaleRemoteHydrationError,
} from "../../../workflows/container-contents/remoteHydration";
import { isDatabaseUnavailableError } from "../../../workflows/container-contents/syncLane";
import { ownsContainerStore } from "../containerState/storeScope";
import { refreshLocalContainerStates } from "../localRefresh";
import {
  IDLE_RECOVERY_HYDRATION,
  type RecoveryHydrationEvent,
  type RecoveryHydrationState,
  transitionRecoveryHydration,
} from "./recoveryHydrationMachine";

import type {
  RecoveryHydrationRequest,
  RemoteHydrationRequestInput,
  RemoteHydrationRequestState,
} from "./remoteHydrationRequestTypes";
import {
  captureTreeResetOwner,
  claimTreeReset,
  queueTreeReset,
} from "./treeResetMachine";

function isRequestGenerationCurrent(input: {
  lifecycleGeneration: number;
  state: RemoteHydrationRequestState;
  structuralGeneration: number;
}): boolean {
  return (
    ownsContainerStore(input.state) &&
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
    (state.runtime.liveHydrationStatus?.() ?? "ready") === "ready" &&
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
  if (!ownsHydrationRequest(input)) return Promise.resolve();
  queueRecoveryHydrationRequest(input);
  return hasRemoteHydrationPrerequisites(input.state)
    ? input.resumeRecoveryWork()
    : Promise.resolve();
}

function prepareTreeReset(
  input: RemoteHydrationRequestInput,
): RemoteHydrationRequestInput {
  const coverReset = claimTreeReset(
    input.state,
    !!input.reconnect || !!input.resetAllLaneWatermarks,
  );
  if (!coverReset) return input;
  const onCovered = input.recreateOnFullyHydratedAtStart
    ? input.recreateOnFullyHydratedAfterReset?.()
    : input.onFullyHydrated;
  return {
    ...input,
    followDiscoveredParentLanes: true,
    resetAllLaneWatermarks: true,
    recreateOnFullyHydratedAtStart: false,
    ownsTreeReset: coverReset.isOwned,
    onFullyHydrated: () => {
      coverReset.cover();
      return onCovered?.();
    },
  };
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
  // A restoration or catch-up crawl with an explicit completion hook owns its
  // callback and must run its own pass after prior work settles.
  const needsOwnCrawl =
    !!(input.onFullyHydrated || input.recreateOnFullyHydratedAfterReset) &&
    !!input.followDiscoveredParentLanes;
  if (
    !needsOwnCrawl &&
    input.resetAllLaneWatermarks &&
    input.followDiscoveredParentLanes
  ) {
    input = { ...input, ownsTreeReset: queueTreeReset(state) };
  }
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
    return needsOwnCrawl ||
      needsCurrentGenerationHydration ||
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
    const current = isRequestGenerationCurrent({
      lifecycleGeneration: requestLifecycleGeneration,
      state,
      structuralGeneration: requestStructuralGeneration,
    });
    if (input.retainOnReset === false) {
      return current && hasRemoteHydrationPrerequisites(state)
        ? requestContainerContentsRemoteHydration(input)
        : Promise.resolve();
    }
    return resumeRetainedRecoveryHydration(
      current ? input : createResetRecoveryInput(input),
    );
  });
}

function retryRemoteHydrationAfterReset(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  if (input.retainOnReset === false) return Promise.resolve();
  // The acknowledgement that superseded this crawl owes one that lists the
  // same lanes after it, so this one waits behind it and lists only if that
  // acknowledgement is lost first (`connectAttemptGate.ts`).
  if (input.yieldsToReconnectCrawl?.()) {
    input.state.connectAttemptGate?.park(() =>
      retryRemoteHydrationAfterReset(input),
    );
    return Promise.resolve();
  }
  // The reconnect state machine owns its retry across a reset.
  if (input.reconnect) {
    // A superseded crawl still owes the manual refresh whose reset it consumed.
    // Complete that request under the live store's own generation guard.
    if (
      !input.ownsTreeReset?.() ||
      input.state.runtime.liveHydrationStatus?.() === "retired"
    )
      return Promise.resolve();
    input = { ...input, reconnect: undefined };
  }
  return resumeRetainedRecoveryHydration(createResetRecoveryInput(input));
}

function retainResetRecoveryHydration(
  input: RemoteHydrationRequestInput,
): void {
  if (input.retainOnReset === false) return;
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
    if (input.retainOnReset !== false) queueRecoveryHydrationRequest(input);
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

function ownsHydrationRequest(input: RemoteHydrationRequestInput): boolean {
  return (
    ownsContainerStore(input.state) &&
    input.ownsTreeReset?.() !== false &&
    input.reconnect?.isCurrent() !== false
  );
}

function captureHydrationScope(
  input: RemoteHydrationRequestInput,
): () => boolean {
  const { state } = input;
  const { lifecycleGeneration, structuralGeneration } = state;
  return () =>
    ownsHydrationRequest(input) &&
    isRequestGenerationCurrent({
      state,
      lifecycleGeneration,
      structuralGeneration,
    });
}

function bindManualTreeReset(
  input: RemoteHydrationRequestInput,
): RemoteHydrationRequestInput {
  if (
    !input.resetAllLaneWatermarks ||
    input.ownsTreeReset ||
    input.onFullyHydrated ||
    input.recreateOnFullyHydratedAfterReset
  )
    return input;
  return { ...input, ownsTreeReset: captureTreeResetOwner(input.state) };
}

/**
 * Holds a crawl that yields to the reconnect crawl until the connect attempt
 * in flight settles (`connectAttemptGate.ts`). The crawl it releases starts
 * without waiting again, or is requested again if the store's generation
 * moved meanwhile.
 */
function holdForConnectAttempt(
  input: RemoteHydrationRequestInput,
): Promise<void> | null {
  const { state } = input;
  if (!input.yieldsToReconnectCrawl || !state.connectAttemptGate) return null;
  const { lifecycleGeneration, structuralGeneration } = state;
  return state.connectAttemptGate.hold(() =>
    isRequestGenerationCurrent({
      lifecycleGeneration,
      state,
      structuralGeneration,
    })
      ? requestUnheldHydration(input)
      : retryRemoteHydrationAfterReset(input),
  );
}

export function requestContainerContentsRemoteHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  input = bindManualTreeReset(input);
  if (!ownsHydrationRequest(input)) return Promise.resolve();
  const held = holdForConnectAttempt(input);
  if (!held) return requestUnheldHydration(input);
  input.state.trackHydration?.(held);
  return held;
}

function requestUnheldHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  queueRequestedParentIds(input);
  const readinessBarrier = waitForRemoteHydrationReadiness(input);
  const request = readinessBarrier ?? startHydration(prepareTreeReset(input));
  input.state.trackHydration?.(request);
  return request;
}

function startHydration(input: RemoteHydrationRequestInput): Promise<void> {
  const { host, scheduleSync, state } = input;
  const { followDiscoveredParentLanes, parentIds } =
    consumeQueuedHydrationScope(state, input.followDiscoveredParentLanes);

  let appliedRemoteContainerChange = false;
  let retainInterruptedHydration = false;
  const { lifecycleGeneration, structuralGeneration } = state;
  const isCurrent = captureHydrationScope(input);
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
    stillCurrent: input.reconnect?.isCurrent,
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
        reconnect: input.reconnect,
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
