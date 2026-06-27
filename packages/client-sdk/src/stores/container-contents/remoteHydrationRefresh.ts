interface RemoteHydrationRefreshOptions {
  followDiscoveredParentLanes?: boolean | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
}

type RemoteHydrationRequester = (
  options: RemoteHydrationRefreshOptions,
) => Promise<void>;

interface RemoteHydrationRefreshState {
  containerParentIdsNeedingHydration: Set<string | null>;
  containersById: ReadonlyMap<string, unknown>;
  initialized: boolean;
  remoteHydrationPromise: Promise<void> | null;
  runtime: {
    auth: { isAuthenticated: boolean };
    infra: { dbStatus: string };
    state: { online: boolean };
  };
}

function queueAllRemoteHydrationParentIds(state: RemoteHydrationRefreshState) {
  state.containerParentIdsNeedingHydration.add(null);
  for (const containerId of state.containersById.keys()) {
    state.containerParentIdsNeedingHydration.add(containerId);
  }
}

function canRefreshRemoteHydration(
  state: RemoteHydrationRefreshState,
): boolean {
  return (
    state.runtime.infra.dbStatus === "ready" &&
    state.initialized &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online
  );
}

export function refreshAllRemoteHydration(input: {
  requestHydration: RemoteHydrationRequester;
  state: RemoteHydrationRefreshState;
}): Promise<boolean> {
  const { requestHydration, state } = input;
  if (!canRefreshRemoteHydration(state)) {
    return Promise.resolve(false);
  }

  if (state.remoteHydrationPromise) {
    queueAllRemoteHydrationParentIds(state);
  }

  // An explicit refresh always re-lists the root discovery lane from the start.
  // A grant that makes a new top-level container reachable does not bump that
  // container's updatedAt, so a persisted watermark would hide it forever.
  return requestHydration({
    followDiscoveredParentLanes: true,
    resetRootLaneWatermark: true,
    scheduleSyncAfterHydration: true,
  }).then(() => true);
}

export function refreshRootRemoteHydration(input: {
  requestHydration: RemoteHydrationRequester;
  state: RemoteHydrationRefreshState;
}): Promise<boolean> {
  const { requestHydration, state } = input;
  if (!canRefreshRemoteHydration(state)) {
    return Promise.resolve(false);
  }

  // Startup catch-up only needs the top-level discovery lane. Keep the
  // all-parent traversal reserved for explicit user refresh.
  return requestHydration({
    followDiscoveredParentLanes: false,
    parentIds: [null],
    resetRootLaneWatermark: true,
    scheduleSyncAfterHydration: true,
  }).then(() => true);
}
