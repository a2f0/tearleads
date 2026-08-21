import {
  hydrateRemoteContainers,
  type RemoteContainerHydrationHost,
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

class StaleRemoteHydrationError extends Error {}

function createGenerationGuardedHydrationHost(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
}): RemoteContainerHydrationHost {
  const assertCurrent = () => {
    if (!input.isCurrent()) {
      throw new StaleRemoteHydrationError();
    }
  };

  return {
    persistContainerState: async (...args) => {
      assertCurrent();
      const record = await input.host.persistContainerState(...args);
      assertCurrent();
      return record;
    },
    ...(input.host.requestDocumentPriming
      ? {
          requestDocumentPriming: () => {
            if (input.isCurrent()) {
              input.host.requestDocumentPriming?.();
            }
          },
        }
      : {}),
    updateSnapshot: () => {
      if (input.isCurrent()) {
        input.host.updateSnapshot();
      }
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
  const needsCurrentGenerationHydration =
    state.remoteHydrationGeneration !== state.lifecycleGeneration;
  const requestQueuedHydration = () =>
    needsCurrentGenerationHydration ||
    state.containerParentIdsNeedingHydration.size > 0
      ? requestContainerContentsRemoteHydration(input)
      : undefined;
  return activeHydration.then(
    requestQueuedHydration,
    (error: unknown) => requestQueuedHydration() ?? Promise.reject(error),
  );
}

export function requestContainerContentsRemoteHydration(
  input: RemoteHydrationRequestInput,
): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (input.parentIds) {
    for (const parentId of input.parentIds) {
      state.containerParentIdsNeedingHydration.add(parentId);
    }
  }

  const activeHydration = waitForActiveRemoteHydration(input);
  if (activeHydration) {
    return activeHydration;
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
    });
  state.remoteHydrationPromise = hydrationPromise;

  return hydrationPromise;
}
