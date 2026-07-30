export interface RemoteHydrationRefreshOptions {
  followDiscoveredParentLanes?: boolean | undefined;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
  resetRootLaneWatermark?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSyncOnHydrationChange?: boolean | undefined;
}

export type RemoteHydrationRequester = (
  options: RemoteHydrationRefreshOptions,
) => Promise<void>;

interface RemoteHydrationRefreshState {
  containerParentIdsNeedingHydration: Set<string | null>;
  containersById: ReadonlyMap<string, unknown>;
  initialized: boolean;
  remoteHydrationPromise: Promise<void> | null;
  runtime: {
    auth: {
      isAuthenticated: boolean;
      organizationId?: string | null | undefined;
    };
    infra: { dbStatus: string };
    state: { containerId?: string | null | undefined; online: boolean };
  };
}

interface RefreshRootContainerLike {
  container: {
    id: string;
    metadataDocumentId?: string | null | undefined;
    organizationId: string | null;
    parentId: string | null;
  };
}

function isRefreshRootContainerLike(
  value: unknown,
): value is RefreshRootContainerLike {
  if (typeof value !== "object" || value === null || !("container" in value)) {
    return false;
  }

  const container = Reflect.get(value, "container");
  return typeof container === "object" && container !== null;
}

// Resolve the parent whose child lane the provisioned-system-container poll
// should list to pull organization-born children (Trash) into the tree.
//
// It must NOT trust runtime.state.containerId: after a cold-cache login of an
// already-registered user, that value is still the pre-auth device-first LOCAL
// root (organizationId "", no remote metadata) — login() never adopts the server
// root id, and reconcileLocalOnlyRootContainers later deletes the local root out
// from under it. Listing that dead local root's child lane returns nothing, so
// the poll never pulls Trash, never satisfies its stop condition, and spins its
// whole retry budget churning the tree (the sidebar flicker).
//
// Prefer instead the reconciled server root already in the tree: the top-level
// (parentId === null) container in the viewer's own organization that carries
// remote metadata. Fall back to runtime.state.containerId when no such root is
// loaded yet — the null discovery lane then surfaces it and hydrateRemoteContainers
// crawls a freshly-discovered container's child lane within the same pass.
function resolveActiveRootChildLaneParentId(
  state: RemoteHydrationRefreshState,
): string | null | undefined {
  const organizationId = state.runtime.auth.organizationId ?? null;
  if (organizationId !== null) {
    for (const value of state.containersById.values()) {
      if (!isRefreshRootContainerLike(value)) {
        continue;
      }
      const { container } = value;
      if (
        container.parentId === null &&
        container.organizationId === organizationId &&
        (container.metadataDocumentId ?? null) !== null
      ) {
        return container.id;
      }
    }
  }

  return state.runtime.state.containerId;
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
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  requestHydration: RemoteHydrationRequester;
  resetAllLaneWatermarks?: boolean | undefined;
  scheduleSyncAfterHydration?: boolean | undefined;
  scheduleSyncOnHydrationChange?: boolean | undefined;
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
    onFullyHydrated: input.onFullyHydrated,
    ...(input.resetAllLaneWatermarks ? { resetAllLaneWatermarks: true } : {}),
    resetRootLaneWatermark: true,
    scheduleSyncAfterHydration: input.scheduleSyncAfterHydration ?? true,
    ...(input.scheduleSyncOnHydrationChange === false
      ? { scheduleSyncOnHydrationChange: false }
      : {}),
  }).then(() => true);
}

export function refreshRootRemoteHydration(input: {
  includeActiveRootChildLane?: boolean | undefined;
  parentIds?: ReadonlyArray<string | null> | undefined;
  requestHydration: RemoteHydrationRequester;
  state: RemoteHydrationRefreshState;
}): Promise<boolean> {
  const { requestHydration, state } = input;
  if (!canRefreshRemoteHydration(state)) {
    return Promise.resolve(false);
  }

  if (input.includeActiveRootChildLane) {
    // Provisioned-system-container poll: it fires on a ~250ms interval until the
    // org-born slot (Trash) surfaces. List the reconciled server root's child
    // lane directly — resolved from the tree, NOT from runtime.state.containerId,
    // which after a cold-cache login is still the pre-auth device-first local root
    // that Trash does not live under — so Trash is pulled instead of the poll
    // spinning on a dead lane. Crucially do NOT reset the root-lane watermark on
    // this path: an unwatermarked re-list every tick makes hydrateRemoteContainers
    // count every listed container as "changed", re-running
    // updateSnapshot()+scheduleSync() on every tick and churning settling nodes'
    // sync badges for the whole poll window — the sidebar "You"/Trash flicker. The
    // stored watermark still surfaces Trash (a cold cache lists in full; a later
    // arrival advances the child lane past it).
    const activeRootChildLaneParentId =
      resolveActiveRootChildLaneParentId(state);
    return requestHydration({
      followDiscoveredParentLanes: false,
      parentIds: activeRootChildLaneParentId
        ? [null, activeRootChildLaneParentId]
        : [null],
    }).then(() => true);
  }

  // Automatic catch-up and the shared_with_you discovery event only need the
  // top-level lane, but they DO re-list it unwatermarked: a root newly shared with
  // the viewer does not bump the viewer's persisted root-lane watermark, so a
  // watermarked list would hide it forever. hydrateRemoteContainers then crawls a
  // freshly discovered root's child lane within the same pass. (The all-parent
  // traversal stays reserved for explicit user refresh in refreshAllRemoteHydration.)
  //
  // The resync_required handler additionally passes the flagged container's parent
  // lane here. A deleted nested container's tombstone is only returned by its
  // parent lane (rootDiscoveryVisible=false), never the root lane, so re-listing
  // that parent lane is what applies the tombstone and drops the stale container
  // without falling back to the full crawl. Those parent lanes keep their persisted
  // watermark (a deletion bumps the tombstone's updatedAt, so it still surfaces);
  // only the root lane is unwatermarked, for the newly-shared-root case above.
  const parentLanes = Array.from(
    new Set<string | null>([null, ...(input.parentIds ?? [])]),
  );
  return requestHydration({
    followDiscoveredParentLanes: false,
    parentIds: parentLanes,
    resetRootLaneWatermark: true,
  }).then(() => true);
}
