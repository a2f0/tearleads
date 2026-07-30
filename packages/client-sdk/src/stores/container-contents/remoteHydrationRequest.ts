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
    remoteHydrationPromise: Promise<void> | null;
    rootLaneHydrated: boolean;
    snapshot: {
      ready: boolean;
    };
  };

export function requestContainerContentsRemoteHydration(input: {
  followDiscoveredParentLanes?: boolean | undefined;
  host: RemoteContainerHydrationHost;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSync: () => void;
  state: RemoteHydrationRequestState;
}): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (input.parentIds) {
    for (const parentId of input.parentIds) {
      state.containerParentIdsNeedingHydration.add(parentId);
    }
  }

  if (state.remoteHydrationPromise) {
    const requestQueuedHydration = () =>
      state.containerParentIdsNeedingHydration.size > 0
        ? requestContainerContentsRemoteHydration(input)
        : undefined;
    return state.remoteHydrationPromise.then(
      requestQueuedHydration,
      (error: unknown) => requestQueuedHydration() ?? Promise.reject(error),
    );
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
  const rootLaneHydratedBeforeRequest = state.rootLaneHydrated;
  state.remoteHydrationPromise = refreshLocalContainerStates({ host, state })
    .then(() =>
      hydrateRemoteContainers({
        followDiscoveredParentLanes,
        host,
        onFullyHydrated: input.onFullyHydrated,
        parentIds,
        resetRootLaneWatermark: input.resetRootLaneWatermark,
        state,
      }),
    )
    .then((changedCount) => {
      appliedRemoteContainerChange = changedCount > 0;
    })
    .catch((error: unknown) => {
      if (isDatabaseUnavailableError(error)) {
        return;
      }

      throw error;
    })
    .finally(() => {
      state.remoteHydrationPromise = null;

      if (
        (appliedRemoteContainerChange ||
          (!rootLaneHydratedBeforeRequest && state.rootLaneHydrated) ||
          input.scheduleSyncAfterHydration) &&
        state.snapshot.ready &&
        state.runtime.auth.isAuthenticated &&
        state.runtime.state.online
      ) {
        scheduleSync();
      }
    });

  return state.remoteHydrationPromise;
}
