import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  createContainerContentsProjectionUserKeyResolver,
  didContainerContentsProjectionKeyRuntimeChange,
} from "../../workflows/container-contents/projectionKeys";
import { didRegainSyncPrerequisites } from "../../workflows/container-contents/syncLane";
import { ContainerStateMap } from "./containerStateMap";
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
import { didContainerWriteRuntimeChange } from "./writeGeneration";

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
      leftNode.effectiveAccessLevel === rightNode.effectiveAccessLevel &&
      leftNode.id === rightNode.id &&
      leftNode.icon === rightNode.icon &&
      leftNode.kind === rightNode.kind &&
      leftNode.metadataDocumentId === rightNode.metadataDocumentId &&
      leftNode.name === rightNode.name &&
      leftNode.organizationId === rightNode.organizationId &&
      leftNode.parentId === rightNode.parentId &&
      areSyncStatesEqual(leftNode.syncState, rightNode.syncState) &&
      leftNode.systemSlot === rightNode.systemSlot &&
      leftNode.updatedAt === rightNode.updatedAt
    );
  });
}

function didStructuralRuntimeChange(
  previousRuntime: ContainerContentsStoreRuntime,
  nextRuntime: ContainerContentsStoreRuntime,
): boolean {
  return (
    previousRuntime.adoptRootContainer !== nextRuntime.adoptRootContainer ||
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.auth.defaultOrganizationId !==
      nextRuntime.auth.defaultOrganizationId ||
    previousRuntime.auth.isAuthenticated !== nextRuntime.auth.isAuthenticated ||
    previousRuntime.auth.organizationId !== nextRuntime.auth.organizationId ||
    previousRuntime.auth.userId !== nextRuntime.auth.userId ||
    previousRuntime.crypto.encapsulationKeyPair !==
      nextRuntime.crypto.encapsulationKeyPair ||
    previousRuntime.crypto.signingFingerprint !==
      nextRuntime.crypto.signingFingerprint ||
    previousRuntime.crypto.signingKeyPair !==
      nextRuntime.crypto.signingKeyPair ||
    previousRuntime.infra.blobStore !== nextRuntime.infra.blobStore ||
    previousRuntime.infra.dbStatus !== nextRuntime.infra.dbStatus ||
    previousRuntime.infra.documentProjectors !==
      nextRuntime.infra.documentProjectors ||
    previousRuntime.infra.execSql !== nextRuntime.infra.execSql ||
    previousRuntime.resolveTrustedUserIdentity !==
      nextRuntime.resolveTrustedUserIdentity ||
    previousRuntime.state.containerId !== nextRuntime.state.containerId ||
    previousRuntime.state.domainScope !== nextRuntime.state.domainScope ||
    previousRuntime.state.online !== nextRuntime.state.online ||
    previousRuntime.state.peerScope !== nextRuntime.state.peerScope ||
    previousRuntime.state.serverEventsConnectionGeneration !==
      nextRuntime.state.serverEventsConnectionGeneration ||
    previousRuntime.util.isRemoteSyncBlocked !==
      nextRuntime.util.isRemoteSyncBlocked ||
    previousRuntime.util.log !== nextRuntime.util.log ||
    previousRuntime.util.logError !== nextRuntime.util.logError ||
    previousRuntime.util.reportSecurityIncident !==
      nextRuntime.util.reportSecurityIncident
  );
}

export function createContainerContentsStoreState(
  initialRuntime: ContainerContentsStoreRuntime,
  persistence: ContainerContentsPersistence,
  logLabel?: string | undefined,
): ContainerContentsStoreState {
  return {
    containersById: new ContainerStateMap(),
    containerParentIdsNeedingHydration: new Set(),
    documentStoresNeedPriming: true,
    initializeGeneration: null,
    initializePromise: null,
    initialized: false,
    localContainerRefreshPromise: null,
    localContainerRefreshGeneration: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: false,
    lifecycleGeneration: 0,
    lastEventCount: 0,
    listeners: new Set(),
    locallyAcceptedMetadataUpdateIds: new Set(),
    logLabel,
    metadataDocumentIdsNeedingSync: new Set(),
    metadataSyncSignalSeqById: new Map(),
    persistence,
    remoteHydrationPromise: null,
    remoteHydrationGeneration: null,
    remoteHydrationStructuralGeneration: null,
    resolveProjectionUserKey:
      createContainerContentsProjectionUserKeyResolver(initialRuntime),
    rootLaneHydrated: false,
    runtime: initialRuntime,
    snapshot: {
      nodes: [],
      ready: false,
    },
    syncLane: null,
    structuralGeneration: 0,
    writeGeneration: 0,
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
  state.lifecycleGeneration += 1;
  state.containersById = new ContainerStateMap();
  state.containerParentIdsNeedingHydration = new Set();
  state.documentStoresNeedPriming = true;
  state.initialized = false;
  state.localContainersNeedRefresh = false;
  // Runtime events are snapshots, not a destructive queue. A replacement
  // executor or persistence adapter has not observed any of them, even when
  // their effects were already applied to the previous database. Replay the
  // snapshot after replacement initialization rebuilds metadata identities.
  state.lastEventCount = 0;
  // Accepted-echo suppression state must not survive a reset: after a
  // database loss the tree rehydrates from remote, and a retained id would
  // suppress the next matching remote update signal. Mirrors
  // clearDocumentStoreState in the document store lane.
  state.locallyAcceptedMetadataUpdateIds = new Set();
  state.metadataDocumentIdsNeedingSync = new Set();
  state.metadataSyncSignalSeqById = new Map();
  state.rootLaneHydrated = false;
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
  const runtimeReplaced = didStructuralRuntimeChange(
    previousRuntime,
    nextRuntime,
  );
  if (didContainerWriteRuntimeChange(previousRuntime, nextRuntime)) {
    state.writeGeneration += 1;
  }
  const executorReplaced =
    previousRuntime.infra.execSql !== nextRuntime.infra.execSql;
  const serverEventsConnectionChanged =
    previousRuntime.state.serverEventsConnectionGeneration !==
    nextRuntime.state.serverEventsConnectionGeneration;
  if (runtimeReplaced) {
    state.structuralGeneration += 1;
    state.localContainersNeedRefresh = true;
  }
  const contextChanged =
    previousRuntime.auth.organizationId !== nextRuntime.auth.organizationId ||
    previousRuntime.state.containerId !== nextRuntime.state.containerId;
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
    return;
  }

  if (executorReplaced) {
    // The in-memory tree and lane markers belong to the previous executor.
    // Rebuild them from the replacement database before any remote sync can
    // observe or persist the old database's state.
    resetContainerContentsStore(state);
    syncAgent.ensureInitialized();
    syncAgent.handleRemoteEvents();
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
    (contextChanged || didRegainSyncPrerequisites(previousRuntime, nextRuntime))
  ) {
    state.localContainersNeedRefresh = true;
    state.documentStoresNeedPriming = true;
    void syncAgent.refreshLocalContainers();
    // The refresh alone does not run the sync lane; schedule it so newly
    // eligible documents (e.g. this organization's orphans) prime now.
    syncAgent.scheduleSync();
  }

  syncAgent.ensureInitialized();

  syncAgent.handleRemoteEvents();

  if (runtimeReplaced) {
    void syncAgent.refreshLocalContainers();
    syncAgent.scheduleSync();
  }

  if (state.snapshot.ready && serverEventsConnectionChanged) {
    // Re-list every reachable remote lane after reconnect. The local sync lane
    // may legitimately skip clean metadata, while events missed between
    // connections can describe new, moved, or deleted nested containers.
    void syncAgent.refresh();
  }

  if (
    state.snapshot.ready &&
    didRegainSyncPrerequisites(previousRuntime, nextRuntime)
  ) {
    // A pass blocked by missing prerequisites consumes its lane request before
    // returning early. Re-arm it directly when they return even if hydration
    // finds no remote delta; this also primes unopened document stores.
    syncAgent.scheduleSync();
    syncAgent.scheduleRemoteHydration();
  }
}

export function updateContainerContentsStorePersistence(
  state: ContainerContentsStoreState,
  nextPersistence: ContainerContentsPersistence,
  syncAgent: ContainerContentsStoreSyncAgent,
): void {
  if (state.persistence === nextPersistence) {
    return;
  }
  state.persistence = nextPersistence;
  state.structuralGeneration += 1;
  state.writeGeneration += 1;
  // Persistence replacement changes the authoritative local data source even
  // when the SQLite executor itself is stable. Clear storage-backed state and
  // let initialization load the replacement before scheduling remote work.
  resetContainerContentsStore(state);
  syncAgent.ensureInitialized();
}
