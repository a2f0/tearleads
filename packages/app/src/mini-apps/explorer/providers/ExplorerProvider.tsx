import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
} from "@tearleads/loro";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../../data/AppDataProvider";
import {
  type ContainerRecord,
  createInitializedContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../../data/containers";
import {
  createDocumentEncryptionMaterial,
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  resolveRecipientPublicKeys,
  serializeDocumentRecipientEnvelopes,
} from "../../../data/documentSync";
import { requestDomainDocumentSync } from "../../../data/documents/DocumentsProvider";
import type { DocumentRecord } from "../../../data/persistence/documentPersistence";
import { didRegainSyncPrerequisites } from "../../../data/sync/syncCoordinator";
import {
  type ExplorerPersistence,
  sqlExplorerPersistence,
} from "../explorerPersistence";
import type { ContainerNode } from "../types";
import {
  type ContainerMetadataDocument,
  type ContainerState,
  createExplorerSyncAgent,
  type ExplorerContainerPatch,
  type ExplorerRuntime,
  type ExplorerSyncAgent,
  type ExplorerSyncState,
  getFallbackContainerName,
} from "./explorerSyncAgent";

interface ExplorerContextValue {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerStore {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

interface ExplorerStoreState extends ExplorerSyncState {
  listeners: Set<() => void>;
  snapshot: ExplorerSnapshot;
  writeChain: Promise<ContainerNode | null>;
}

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

function toContainerNode(container: ContainerRecord): ContainerNode {
  return {
    id: container.id,
    kind: "container",
    name: container.name,
    organizationId: container.organizationId,
    parentId: container.parentId,
  };
}

function isContainerInSubtree(
  containersById: ReadonlyMap<string, ContainerState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentContainerId: string | null = containerId;
  const visitedContainerIds = new Set<string>();

  while (currentContainerId !== null) {
    if (currentContainerId === rootContainerId) {
      return true;
    }

    if (visitedContainerIds.has(currentContainerId)) {
      return false;
    }
    visitedContainerIds.add(currentContainerId);

    const currentContainerState = containersById.get(currentContainerId);
    currentContainerId = currentContainerState?.container.parentId ?? null;
  }

  return false;
}

function getSnapshotNodes(
  containersById: ReadonlyMap<string, ContainerState>,
): ReadonlyArray<ContainerNode> {
  return Array.from(containersById.values(), (containerState) =>
    toContainerNode(containerState.container),
  ).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    }),
  );
}

function createExplorerStoreState(
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
    next.nodes === state.snapshot.nodes
  ) {
    return;
  }

  state.snapshot = next;
  emitExplorerStore(state);
}

function updateExplorerSnapshot(state: ExplorerStoreState) {
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

async function persistContainerState(
  state: ExplorerStoreState,
  containerState: ContainerState,
  patch: Partial<ExplorerContainerPatch> = {},
  updateView = true,
): Promise<DocumentRecord> {
  const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
    patch,
    "documentRecipientEnvelopes",
  );
  const currentDocumentId = containerState.record.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const hasLastCommitLsnPatch = Object.hasOwn(patch, "lastCommitLsn");
  const nextAccessEpoch =
    patch.accessEpoch ?? containerState.record.accessEpoch;
  const metadata = readContainerMetadataValue(
    containerState.doc,
    getFallbackContainerName(containerState.container.parentId),
  );
  const nextContainer: ContainerRecord = {
    ...containerState.container,
    organizationId:
      patch.organizationId ?? containerState.container.organizationId,
    parentId: patch.parentId ?? containerState.container.parentId,
    metadataDocumentId:
      patch.metadataDocumentId ??
      patch.documentId ??
      containerState.container.metadataDocumentId,
    name: patch.name ?? metadata.name,
    icon: patch.icon ?? metadata.icon,
  };
  const nextRecord: DocumentRecord = {
    id: containerState.container.id,
    documentId: nextDocumentId,
    documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
      ? (patch.documentRecipientEnvelopes ?? null)
      : nextAccessEpoch !== containerState.record.accessEpoch
        ? null
        : containerState.record.documentRecipientEnvelopes,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(containerState.doc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash:
      patch.accessStateHash ?? containerState.record.accessStateHash ?? null,
    lastCommitLsn: hasLastCommitLsnPatch
      ? (patch.lastCommitLsn ?? null)
      : nextDocumentId !== currentDocumentId
        ? null
        : (containerState.record.lastCommitLsn ?? null),
  };

  await state.persistence.saveContainer(
    state.runtime.execSql,
    nextContainer,
    nextRecord,
  );
  containerState.container = nextContainer;
  containerState.record = nextRecord;
  if (updateView) {
    updateExplorerSnapshot(state);
  }
  return nextRecord;
}

async function buildRemoteChildContainerState(
  state: ExplorerStoreState,
  parentState: ContainerState,
  childId: string,
  trimmedName: string,
  doc: ContainerMetadataDocument,
  initialRecord: DocumentRecord,
  initialUpdate: Uint8Array,
) {
  if (
    typeof parentState.record.accessStateHash !== "string" ||
    parentState.record.accessStateHash.length === 0
  ) {
    state.runtime.log(
      `Explorer: container ${parentState.container.id} is missing access state hash for create`,
    );
    return null;
  }

  const initialDocumentEncryption = await createDocumentEncryptionMaterial(
    parentState.recipientPublicKeys,
  );
  const pendingUpdateFields = createPendingUpdateFields(initialUpdate);
  const initialMetadataUpdates = pendingUpdateFields
    ? await encryptPendingUpdates(
        [
          {
            id: crypto.randomUUID(),
            ...pendingUpdateFields,
          },
        ],
        initialRecord.accessEpoch,
        initialDocumentEncryption.documentKey,
      )
    : [];
  const created = await state.runtime.apiClient.createContainer(
    childId,
    parentState.container.id,
    parentState.record.accessStateHash,
    initialMetadataUpdates,
    initialDocumentEncryption.documentRecipientEnvelopes,
  );

  if (!created) {
    return null;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    created.metadataReferencedPrincipals,
  );

  return {
    container: {
      id: created.id,
      organizationId: created.organizationId,
      parentId: created.parentId,
      metadataDocumentId: created.metadataDocumentId,
      name: trimmedName,
      icon: null,
    },
    doc,
    recipientPublicKeys: resolveRecipientPublicKeys(
      created.metadataRecipientEncapsulationPublicKeys,
    ),
    record: {
      ...initialRecord,
      accessEpoch: created.metadataAccessEpoch,
      accessStateHash: created.metadataAccessStateHash,
      documentId: created.metadataDocumentId,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        initialDocumentEncryption.documentRecipientEnvelopes,
      ),
    },
  };
}

function buildLocalChildContainerState(
  state: ExplorerStoreState,
  parentState: ContainerState,
  childId: string,
  trimmedName: string,
  doc: ContainerMetadataDocument,
  initialRecord: DocumentRecord,
): ContainerState {
  return {
    container: {
      id: childId,
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      name: trimmedName,
      icon: null,
    },
    doc,
    recipientPublicKeys: getLocalRecipientPublicKeys(
      state.runtime.encapsulationKeyPair,
    ),
    record: initialRecord,
  };
}

async function createChildContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  parentId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const parentState = state.containersById.get(parentId);
  if (!parentState) {
    return null;
  }

  const childId = crypto.randomUUID();
  const { doc, initialUpdate } =
    await createInitializedContainerMetadataDocument(childId, {
      icon: null,
      name: trimmedName,
    });
  const initialRecord: DocumentRecord = {
    accessEpoch: 1,
    accessStateHash: null,
    documentId: null,
    documentRecipientEnvelopes: null,
    id: childId,
    lastCommitLsn: null,
    loroSnapshot: bytesToBase64(initialUpdate),
  };
  const childState =
    state.runtime.isAuthenticated && state.runtime.encapsulationKeyPair
      ? await buildRemoteChildContainerState(
          state,
          parentState,
          childId,
          trimmedName,
          doc,
          initialRecord,
          initialUpdate,
        )
      : buildLocalChildContainerState(
          state,
          parentState,
          childId,
          trimmedName,
          doc,
          initialRecord,
        );

  if (!childState) {
    return null;
  }

  await state.persistence.saveContainer(
    state.runtime.execSql,
    childState.container,
    childState.record,
  );

  if (!childState.record.documentId) {
    await syncAgent.enqueuePendingContainerUpdate(
      childState.container.id,
      initialUpdate,
    );
  }

  state.containersById.set(childState.container.id, childState);
  updateExplorerSnapshot(state);
  state.runtime.log(`Explorer: created container "${trimmedName}"`);
  return toContainerNode(childState.container);
}

async function deleteExplorerContainer(
  state: ExplorerStoreState,
  containerId: string,
) {
  if (state.runtime.dbStatus !== "ready" || !state.snapshot.ready) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (
    !existingState ||
    existingState.container.parentId === null ||
    Array.from(state.containersById.values()).some(
      (containerState) => containerState.container.parentId === containerId,
    )
  ) {
    return null;
  }

  const deletedNode = toContainerNode(existingState.container);
  await state.persistence.deleteContainer(
    state.runtime.execSql,
    existingState.container.id,
  );
  state.containersById.delete(existingState.container.id);
  updateExplorerSnapshot(state);
  state.runtime.log(
    `Explorer: deleted container "${existingState.container.name}"`,
  );
  return deletedNode;
}

async function renameExplorerContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  name: string,
) {
  const trimmedName = name.trim();
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !trimmedName
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (!existingState) {
    return null;
  }

  if (existingState.container.name === trimmedName) {
    return toContainerNode(existingState.container);
  }

  const previousVersion = encodeVersionVector(existingState.doc);
  writeContainerMetadataValue(existingState.doc, {
    icon: existingState.container.icon,
    name: trimmedName,
  });
  const update = exportUpdatesSince(existingState.doc, previousVersion);

  await syncAgent.enqueuePendingContainerUpdate(
    existingState.container.id,
    update,
  );
  await persistContainerState(state, existingState, { name: trimmedName });
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: renamed container to "${trimmedName}"`);
  return toContainerNode(existingState.container);
}

async function shareExplorerContainerWithUser(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  userId: string,
) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const expectedAccessStateHash = existingState?.record.accessStateHash;
  if (
    !existingState?.record.documentId ||
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    return null;
  }

  const shared = await state.runtime.apiClient.shareContainer(
    containerId,
    "user",
    userId,
    "write",
    expectedAccessStateHash,
  );

  if (!shared) {
    return null;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    shared.metadataReferencedPrincipals,
  );

  existingState.recipientPublicKeys = resolveRecipientPublicKeys(
    shared.metadataRecipientEncapsulationPublicKeys,
  );
  await persistContainerState(state, existingState, {
    accessEpoch: shared.metadataAccessEpoch,
    accessStateHash: shared.metadataAccessStateHash,
    documentId: shared.metadataDocumentId,
    documentRecipientEnvelopes: existingState.record.documentRecipientEnvelopes,
    metadataDocumentId: shared.metadataDocumentId,
  });
  await syncAgent.primeDocumentsForSharedSubtree(containerId);
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(`Explorer: shared container ${containerId} with ${userId}`);
  return toContainerNode(existingState.container);
}

async function moveExplorerContainer(
  state: ExplorerStoreState,
  syncAgent: ExplorerSyncAgent,
  containerId: string,
  parentId: string,
) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const targetParentState = state.containersById.get(parentId);
  if (
    !existingState ||
    !targetParentState ||
    existingState.container.parentId === null ||
    isContainerInSubtree(state.containersById, parentId, containerId) ||
    typeof existingState.record.accessStateHash !== "string" ||
    existingState.record.accessStateHash.length === 0
  ) {
    return null;
  }

  const moved = await state.runtime.apiClient.moveContainer(
    containerId,
    parentId,
    existingState.record.accessStateHash,
  );
  if (!moved) {
    return null;
  }

  await syncAgent.ingestRemoteContainer(moved);
  await syncAgent.requestRemoteHydration();
  requestDomainDocumentSync(state.runtime.domainScope);
  syncAgent.scheduleSync();
  state.runtime.log(
    `Explorer: moved container ${containerId} under ${parentId}`,
  );
  return toContainerNode(existingState.container);
}

function subscribeToExplorerStore(
  state: ExplorerStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function updateExplorerStoreRuntime(
  state: ExplorerStoreState,
  nextRuntime: ExplorerRuntime,
  syncAgent: ExplorerSyncAgent,
) {
  const previousRuntime = state.runtime;
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

  for (const containerState of state.containersById.values()) {
    if (!containerState.record.documentId) {
      containerState.recipientPublicKeys = getLocalRecipientPublicKeys(
        state.runtime.encapsulationKeyPair,
      );
    }
  }

  syncAgent.ensureInitialized();

  syncAgent.handleRemoteEvents();

  if (
    state.snapshot.ready &&
    didRegainSyncPrerequisites(previousRuntime, nextRuntime)
  ) {
    syncAgent.scheduleRemoteHydration();
  }
}

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
  persistence: ExplorerPersistence = sqlExplorerPersistence,
): ExplorerStore {
  const state = createExplorerStoreState(initialRuntime, persistence);
  const syncAgent = createExplorerSyncAgent({
    host: {
      persistContainerState: (containerState, patch, updateView) =>
        persistContainerState(state, containerState, patch, updateView),
      updateSnapshot: () => updateExplorerSnapshot(state),
    },
    state,
  });

  return {
    createChild: (parentId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => createChildContainer(state, syncAgent, parentId, name));
      return state.writeChain;
    },
    deleteContainer: (containerId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => deleteExplorerContainer(state, containerId));
      return state.writeChain.then((deletedNode) => deletedNode !== null);
    },
    moveContainer: (containerId: string, parentId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          moveExplorerContainer(state, syncAgent, containerId, parentId),
        );
      return state.writeChain;
    },
    refresh: () => syncAgent.refresh(),
    renameContainer: (containerId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          renameExplorerContainer(state, syncAgent, containerId, name),
        );
      return state.writeChain;
    },
    shareWithUser: (containerId: string, userId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          shareExplorerContainerWithUser(state, syncAgent, containerId, userId),
        );
      return state.writeChain.then((sharedNode) => sharedNode !== null);
    },
    getSnapshot: () => state.snapshot,
    subscribe: (listener) => subscribeToExplorerStore(state, listener),
    updateRuntime: (runtime) =>
      updateExplorerStoreRuntime(state, runtime, syncAgent),
  };
}

function getOrCreateExplorerStore(
  domainScope: object,
  runtime: ExplorerRuntime,
): ExplorerStore {
  const existingStore = explorerStoresByScope.get(domainScope);
  if (existingStore) {
    return existingStore;
  }

  const nextStore = createExplorerStore(runtime);
  explorerStoresByScope.set(domainScope, nextStore);
  return nextStore;
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const runtime = useAppData();
  const store = useMemo(
    () => getOrCreateExplorerStore(runtime.domainScope, runtime),
    [runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <ExplorerContext.Provider value={store}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorer(): ExplorerContextValue {
  const store = useContext(ExplorerContext);
  if (!store) {
    throw new Error("useExplorer must be used within an ExplorerProvider.");
  }

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    createChild: store.createChild,
    deleteContainer: store.deleteContainer,
    moveContainer: store.moveContainer,
    refresh: store.refresh,
    renameContainer: store.renameContainer,
    shareWithUser: store.shareWithUser,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  };
}
