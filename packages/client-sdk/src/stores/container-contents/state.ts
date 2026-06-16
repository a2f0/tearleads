import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  createContainerContentsProjectionUserKeyResolver,
  didContainerContentsProjectionKeyRuntimeChange,
} from "../../workflows/container-contents/projectionKeys";
import { didRegainContainerContentsSyncPrerequisites } from "../../workflows/container-contents/syncLane";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncAgent,
} from "./syncAgent";
import type {
  ContainerContentsSnapshot,
  ContainerContentsStoreState,
  ContainerNode,
} from "./types";
import { getSnapshotNodes } from "./utils";

function areSyncStatesEqual(
  left: ContainerNode["syncState"],
  right: ContainerNode["syncState"],
): boolean {
  return (
    left.lastError === right.lastError &&
    left.pendingAttachmentBytes === right.pendingAttachmentBytes &&
    left.pendingAttachmentCount === right.pendingAttachmentCount &&
    left.pendingUpdateCount === right.pendingUpdateCount &&
    left.status === right.status
  );
}

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
      leftNode.createdAt === rightNode.createdAt &&
      leftNode.id === rightNode.id &&
      leftNode.kind === rightNode.kind &&
      leftNode.metadataDocumentId === rightNode.metadataDocumentId &&
      leftNode.name === rightNode.name &&
      leftNode.organizationId === rightNode.organizationId &&
      leftNode.parentId === rightNode.parentId &&
      areSyncStatesEqual(leftNode.syncState, rightNode.syncState) &&
      leftNode.updatedAt === rightNode.updatedAt
    );
  });
}

export function createContainerContentsStoreState(
  initialRuntime: ContainerContentsStoreRuntime,
  persistence: ContainerContentsPersistence,
  logLabel?: string | undefined,
): ContainerContentsStoreState {
  return {
    containersById: new Map(),
    containerParentIdsNeedingHydration: new Set(),
    documentStoresNeedPriming: true,
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    listeners: new Set(),
    logLabel,
    metadataDocumentIdsNeedingSync: new Set(),
    persistence,
    recentContainerMutationHydrationAt: null,
    remoteHydrationPromise: null,
    resolveProjectionUserKey:
      createContainerContentsProjectionUserKeyResolver(initialRuntime),
    runtime: initialRuntime,
    snapshot: {
      nodes: [],
      ready: false,
    },
    syncLane: null,
    writeChain: Promise.resolve<ContainerNode | null>(null),
  };
}

function emitContainerContentsStore(state: ContainerContentsStoreState) {
  for (const listener of state.listeners) {
    listener();
  }
}

function setContainerContentsSnapshot(
  state: ContainerContentsStoreState,
  next: ContainerContentsSnapshot,
) {
  if (
    next.ready === state.snapshot.ready &&
    areSnapshotNodesEqual(next.nodes, state.snapshot.nodes)
  ) {
    return;
  }

  state.snapshot = next;
  emitContainerContentsStore(state);
}

export function updateContainerContentsSnapshot(
  state: ContainerContentsStoreState,
) {
  setContainerContentsSnapshot(state, {
    nodes: getSnapshotNodes(state.containersById),
    ready: true,
  });
}

function resetContainerContentsStore(state: ContainerContentsStoreState) {
  state.containersById = new Map();
  state.containerParentIdsNeedingHydration = new Set();
  state.documentStoresNeedPriming = true;
  state.initialized = false;
  state.initializePromise = null;
  state.metadataDocumentIdsNeedingSync = new Set();
  state.recentContainerMutationHydrationAt = null;
  state.remoteHydrationPromise = null;
  state.writeChain = Promise.resolve<ContainerNode | null>(null);
  setContainerContentsSnapshot(state, {
    nodes: [],
    ready: false,
  });
}

export function subscribeToContainerContentsStore(
  state: ContainerContentsStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function updateContainerContentsStoreRuntime(
  state: ContainerContentsStoreState,
  nextRuntime: ContainerContentsStoreRuntime,
  syncAgent: ContainerContentsStoreSyncAgent,
) {
  const previousRuntime = state.runtime;
  if (
    didContainerContentsProjectionKeyRuntimeChange(previousRuntime, nextRuntime)
  ) {
    state.resolveProjectionUserKey =
      createContainerContentsProjectionUserKeyResolver(nextRuntime);
  }
  state.runtime = nextRuntime;

  if (nextRuntime.infra.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetContainerContentsStore(state);
    }
    state.lastEventCount = nextRuntime.state.events.length;
    return;
  }

  // Gaining authentication within a domain scope does not change identity
  // (the scope is keyed on the signing fingerprint), so the locally-loaded
  // tree stays valid. Reconcile it in place instead of resetting — resetting
  // here is what blanked Explorer and forced a re-read on first open after
  // register. Identity/storage changes are handled by scope rotation and the
  // dbStatus-loss branch above.
  if (
    state.snapshot.ready &&
    didRegainContainerContentsSyncPrerequisites(previousRuntime, nextRuntime)
  ) {
    state.documentStoresNeedPriming = true;
  }

  syncAgent.ensureInitialized();

  syncAgent.handleRemoteEvents();

  if (
    state.snapshot.ready &&
    didRegainContainerContentsSyncPrerequisites(previousRuntime, nextRuntime)
  ) {
    syncAgent.scheduleRemoteHydration();
  }
}
