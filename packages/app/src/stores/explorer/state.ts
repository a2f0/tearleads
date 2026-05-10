import type { ContainerNode } from "../../mini-apps/explorer/types";
import type { ExplorerPersistence } from "../../workflows/explorer";
import type { ExplorerRuntime, ExplorerSyncAgent } from "./explorerSyncAgent";
import type { ExplorerSnapshot, ExplorerStoreState } from "./types";
import { getSnapshotNodes } from "./utils";

function areSnapshotNodesEqual(
  left: ReadonlyArray<ContainerNode>,
  right: ReadonlyArray<ContainerNode>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftNode, index) => {
    const rightNode = right[index];
    return (
      rightNode !== undefined &&
      leftNode.id === rightNode.id &&
      leftNode.kind === rightNode.kind &&
      leftNode.name === rightNode.name &&
      leftNode.organizationId === rightNode.organizationId &&
      leftNode.parentId === rightNode.parentId
    );
  });
}

export function createExplorerStoreState(
  initialRuntime: ExplorerRuntime,
  persistence: ExplorerPersistence,
): ExplorerStoreState {
  return {
    containersById: new Map(),
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    listeners: new Set(),
    persistence,
    remoteHydrationPromise: null,
    resolveProjectionUserKey: initialRuntime.createProjectionUserKeyResolver(),
    runtime: initialRuntime,
    snapshot: {
      nodes: [],
      ready: false,
    },
    syncLane: null,
    writeChain: Promise.resolve<ContainerNode | null>(null),
  };
}

function emitExplorerStore(state: ExplorerStoreState) {
  for (const listener of state.listeners) {
    listener();
  }
}

function setExplorerSnapshot(
  state: ExplorerStoreState,
  next: ExplorerSnapshot,
) {
  if (
    next.ready === state.snapshot.ready &&
    areSnapshotNodesEqual(next.nodes, state.snapshot.nodes)
  ) {
    return;
  }

  state.snapshot = next;
  emitExplorerStore(state);
}

export function updateExplorerSnapshot(state: ExplorerStoreState) {
  setExplorerSnapshot(state, {
    nodes: getSnapshotNodes(state.containersById),
    ready: true,
  });
}

function resetExplorerStore(state: ExplorerStoreState) {
  state.containersById = new Map();
  state.initialized = false;
  state.initializePromise = null;
  state.remoteHydrationPromise = null;
  state.writeChain = Promise.resolve<ContainerNode | null>(null);
  setExplorerSnapshot(state, {
    nodes: [],
    ready: false,
  });
}

export function subscribeToExplorerStore(
  state: ExplorerStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function updateExplorerStoreRuntime(
  state: ExplorerStoreState,
  nextRuntime: ExplorerRuntime,
  syncAgent: ExplorerSyncAgent,
) {
  const previousRuntime = state.runtime;
  if (nextRuntime.didProjectionKeyRuntimeChange(previousRuntime)) {
    state.resolveProjectionUserKey =
      nextRuntime.createProjectionUserKeyResolver();
  }
  state.runtime = nextRuntime;

  if (nextRuntime.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetExplorerStore(state);
    }
    state.lastEventCount = nextRuntime.events.length;
    return;
  }

  if (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) {
    resetExplorerStore(state);
    state.lastEventCount = nextRuntime.events.length;
  }

  syncAgent.ensureInitialized();

  syncAgent.handleRemoteEvents();

  if (
    state.snapshot.ready &&
    nextRuntime.didRegainSyncPrerequisites(previousRuntime)
  ) {
    syncAgent.scheduleRemoteHydration();
  }
}
