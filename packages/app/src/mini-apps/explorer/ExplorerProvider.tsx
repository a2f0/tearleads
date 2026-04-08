import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobStore } from "../../data/blob-store";
import {
  createContainerMetadataDocument,
  createInitializedContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containerMetadataDocument";
import type { ContainerRecord } from "../../data/containerPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/documentPersistence";
import {
  createDocumentEncryptionMaterial,
  createPendingUpdateFields,
  decryptIncomingUpdates,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  getOrCreateDocumentEncryptionMaterial,
  isDocumentUpdateCreatedEvent,
  maybeSeedRewrappedDocumentRecipientEnvelopes,
  parseDocumentRecipientEnvelopes,
  resolveRecipientPublicKeys,
  serializeDocumentRecipientEnvelopes,
} from "../../data/documentSync";
import type { ExecSql } from "../../data/sqlSchema";
import {
  primeNotesStore,
  requestDomainNotesSync,
} from "../notes/NotesProvider";
import {
  listNotesByContainerIds,
  sqlNotesPersistence,
} from "../notes/notesPersistence";
import {
  type ExplorerPersistence,
  sqlExplorerPersistence,
} from "./explorerPersistence";
import type { ContainerNode } from "./types";

type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
type ExplorerAppData = ReturnType<typeof useAppData>;
type CommitDocumentChangeInput = Parameters<
  ExplorerRuntime["apiClient"]["commitDocumentChange"]
>[1];
type StageBlobInput = Parameters<ExplorerRuntime["apiClient"]["stageBlob"]>[0];
type SyncDocumentOutgoingUpdates = Parameters<
  ExplorerRuntime["apiClient"]["syncDocument"]
>[3];
type SyncDocumentRecipientEnvelopes = Parameters<
  ExplorerRuntime["apiClient"]["syncDocument"]
>[4];

interface ExplorerContextValue {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
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

interface ExplorerRuntime {
  apiClient: Pick<
    ExplorerAppData["apiClient"],
    | "commitDocumentChange"
    | "createContainer"
    | "createDocument"
    | "getBlob"
    | "listContainers"
    | "listDocumentAttachments"
    | "shareContainer"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: ExplorerAppData["cacheReferencedPrincipalPolicies"];
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  encapsulationKeyPair: ExplorerAppData["encapsulationKeyPair"];
  events: ExplorerAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
  online: ExplorerAppData["online"];
}

interface ExplorerStore {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
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

interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord;
}

interface ExplorerStoreState {
  containersById: Map<string, ContainerState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  persistence: ExplorerPersistence;
  remoteHydrationPromise: Promise<void> | null;
  runtime: ExplorerRuntime;
  snapshot: ExplorerSnapshot;
  syncPromise: Promise<void> | null;
  syncRequested: boolean;
  writeChain: Promise<ContainerNode | null>;
}

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

function getFallbackContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

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
    syncPromise: null,
    syncRequested: false,
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
  state.syncPromise = null;
  state.remoteHydrationPromise = null;
  state.syncRequested = false;
  state.writeChain = Promise.resolve<ContainerNode | null>(null);
  setExplorerSnapshot(state, {
    nodes: [],
    ready: false,
  });
}

async function persistContainerState(
  state: ExplorerStoreState,
  containerState: ContainerState,
  patch: Partial<{
    accessEpoch: number;
    documentId: string | null;
    documentRecipientEnvelopes: string | null;
    icon: string | null;
    metadataDocumentId: string | null;
    loroSnapshot: string;
    name: string;
    organizationId: string;
    parentId: string | null;
  }> = {},
  updateView = true,
): Promise<DocumentRecord> {
  const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
    patch,
    "documentRecipientEnvelopes",
  );
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
    documentId: patch.documentId ?? containerState.record.documentId,
    documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
      ? (patch.documentRecipientEnvelopes ?? null)
      : nextAccessEpoch !== containerState.record.accessEpoch
        ? null
        : containerState.record.documentRecipientEnvelopes,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(containerState.doc)),
    accessEpoch: nextAccessEpoch,
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

function buildNotesRuntime(state: ExplorerStoreState, containerId: string) {
  return {
    apiClient: {
      commitDocumentChange: (
        documentId: string,
        input: CommitDocumentChangeInput,
      ) => state.runtime.apiClient.commitDocumentChange(documentId, input),
      createDocument: (linkedContainerIds: string[]) =>
        state.runtime.apiClient.createDocument(linkedContainerIds),
      getBlob: (blobId: string) => state.runtime.apiClient.getBlob(blobId),
      listDocumentAttachments: (documentId: string) =>
        state.runtime.apiClient.listDocumentAttachments(documentId),
      stageBlob: (input: StageBlobInput) =>
        state.runtime.apiClient.stageBlob(input),
      syncDocument: (
        documentId: string,
        accessEpoch: number,
        localVersionVector: string,
        outgoingUpdates: SyncDocumentOutgoingUpdates,
        documentRecipientEnvelopes: SyncDocumentRecipientEnvelopes,
      ) =>
        state.runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        ),
    },
    blobStore: state.runtime.blobStore,
    cacheReferencedPrincipalPolicies:
      state.runtime.cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus: state.runtime.dbStatus,
    domainScope: state.runtime.domainScope,
    encapsulationKeyPair: state.runtime.encapsulationKeyPair,
    events: state.runtime.events,
    execSql: state.runtime.execSql,
    isAuthenticated: state.runtime.isAuthenticated,
    log: state.runtime.log,
    online: state.runtime.online,
  };
}

async function primeNotesForSharedSubtree(
  state: ExplorerStoreState,
  rootContainerId: string,
) {
  const sharedContainerIds = new Set(
    Array.from(state.containersById.values())
      .filter((containerState) =>
        isContainerInSubtree(
          state.containersById,
          containerState.container.id,
          rootContainerId,
        ),
      )
      .map((containerState) => containerState.container.id),
  );

  if (sharedContainerIds.size === 0) {
    return;
  }

  await sqlNotesPersistence.ensureSchema(state.runtime.execSql);
  const noteSummaries = await listNotesByContainerIds(
    state.runtime.execSql,
    Array.from(sharedContainerIds),
  );

  for (const noteSummary of noteSummaries) {
    if (
      !noteSummary.containerId ||
      !sharedContainerIds.has(noteSummary.containerId)
    ) {
      continue;
    }

    const notesStore = primeNotesStore(
      state.runtime.domainScope,
      noteSummary.id,
      buildNotesRuntime(state, noteSummary.containerId),
      undefined,
      noteSummary.documentId,
    );
    notesStore.requestSync();
  }
}

async function listPendingContainerUpdates(
  state: ExplorerStoreState,
  containerId: string,
): Promise<PendingUpdateRecord[]> {
  return state.persistence.listPendingUpdates(
    state.runtime.execSql,
    containerId,
  );
}

async function enqueuePendingContainerUpdate(
  state: ExplorerStoreState,
  containerId: string,
  update: Uint8Array,
) {
  const pendingUpdateFields = createPendingUpdateFields(update);
  if (!pendingUpdateFields) {
    return;
  }

  await state.persistence.enqueuePendingUpdate(state.runtime.execSql, {
    containerId,
    ...pendingUpdateFields,
  });
}

async function deletePendingContainerUpdate(
  state: ExplorerStoreState,
  id: string,
) {
  await state.persistence.deletePendingUpdate(state.runtime.execSql, id);
}

async function decryptMetadataUpdates(
  state: ExplorerStoreState,
  encryptedUpdates: ReadonlyArray<{ encryptedData: string }>,
  accessEpoch: number,
  documentKey: Uint8Array,
): Promise<Uint8Array[]> {
  return decryptIncomingUpdates(
    encryptedUpdates,
    accessEpoch,
    documentKey,
    (message) => state.runtime.log(`Explorer: ${message}`),
  );
}

async function hydrateRemoteContainers(
  state: ExplorerStoreState,
): Promise<void> {
  if (
    !state.runtime.isAuthenticated ||
    !state.runtime.online ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  const remoteContainers = await state.runtime.apiClient.listContainers();
  if (!remoteContainers) {
    return;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    remoteContainers.flatMap(
      (remoteContainer) => remoteContainer.metadataReferencedPrincipals ?? [],
    ),
  );

  const localRecipientPublicKeys = getLocalRecipientPublicKeys(
    state.runtime.encapsulationKeyPair,
  );

  for (const remoteContainer of remoteContainers) {
    const existingState = state.containersById.get(remoteContainer.id);

    if (existingState) {
      existingState.recipientPublicKeys = resolveRecipientPublicKeys(
        remoteContainer.metadataRecipientEncapsulationPublicKeys,
        localRecipientPublicKeys,
      );
      await persistContainerState(
        state,
        existingState,
        {
          accessEpoch: remoteContainer.metadataAccessEpoch,
          documentId: remoteContainer.metadataDocumentId,
          metadataDocumentId: remoteContainer.metadataDocumentId,
          organizationId: remoteContainer.organizationId,
          parentId: remoteContainer.parentId,
        },
        false,
      );
      continue;
    }

    const doc = await createContainerMetadataDocument(remoteContainer.id);
    const initialSnapshot = bytesToBase64(exportAllUpdates(doc));
    const containerState: ContainerState = {
      container: {
        id: remoteContainer.id,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        name: getFallbackContainerName(remoteContainer.parentId),
        icon: null,
      },
      doc,
      recipientPublicKeys: resolveRecipientPublicKeys(
        remoteContainer.metadataRecipientEncapsulationPublicKeys,
        localRecipientPublicKeys,
      ),
      record: {
        accessEpoch: remoteContainer.metadataAccessEpoch,
        documentId: remoteContainer.metadataDocumentId,
        documentRecipientEnvelopes: null,
        id: remoteContainer.id,
        loroSnapshot: initialSnapshot,
      },
    };

    await state.persistence.saveContainer(
      state.runtime.execSql,
      containerState.container,
      containerState.record,
    );
    state.containersById.set(remoteContainer.id, containerState);
  }

  if (remoteContainers.length > 0) {
    updateExplorerSnapshot(state);
    state.runtime.log(
      `Explorer: hydrated ${remoteContainers.length} remote container(s)`,
    );
  }
}

function requestRemoteHydration(state: ExplorerStoreState): Promise<void> {
  if (state.remoteHydrationPromise) {
    return state.remoteHydrationPromise;
  }

  state.remoteHydrationPromise = hydrateRemoteContainers(state)
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    })
    .finally(() => {
      state.remoteHydrationPromise = null;

      if (
        state.snapshot.ready &&
        state.runtime.isAuthenticated &&
        state.runtime.online
      ) {
        scheduleExplorerSync(state);
      }
    });

  return state.remoteHydrationPromise;
}

function scheduleRemoteHydration(state: ExplorerStoreState) {
  void requestRemoteHydration(state);
}

async function initializeExplorerStore(
  state: ExplorerStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  await state.persistence.ensureSchema(state.runtime.execSql);
  const storedContainers = await state.persistence.loadContainers(
    state.runtime.execSql,
  );

  for (const storedContainer of storedContainers) {
    const { container } = storedContainer;
    const doc = await createContainerMetadataDocument(container.id);
    let nextContainer = container;
    let nextRecord = storedContainer.record;

    if (nextRecord?.loroSnapshot) {
      importUpdates(doc, [base64ToBytes(nextRecord.loroSnapshot)]);
      const metadata = readContainerMetadataValue(
        doc,
        getFallbackContainerName(container.parentId),
      );
      nextContainer = {
        ...container,
        icon: metadata.icon,
        name: metadata.name,
      };
      await state.persistence.saveContainer(
        state.runtime.execSql,
        nextContainer,
        nextRecord,
      );
    } else {
      writeContainerMetadataValue(doc, {
        icon: container.icon,
        name: container.name,
      });
      const initialUpdate = exportAllUpdates(doc);
      nextRecord = {
        accessEpoch: 1,
        documentId: container.metadataDocumentId,
        documentRecipientEnvelopes: null,
        id: container.id,
        loroSnapshot: bytesToBase64(initialUpdate),
      };
      await state.persistence.saveContainer(
        state.runtime.execSql,
        nextContainer,
        nextRecord,
      );

      if (!container.metadataDocumentId) {
        await enqueuePendingContainerUpdate(state, container.id, initialUpdate);
      }
    }

    state.containersById.set(container.id, {
      container: nextContainer,
      doc,
      recipientPublicKeys: getLocalRecipientPublicKeys(
        state.runtime.encapsulationKeyPair,
      ),
      record: nextRecord,
    });
  }

  state.initialized = true;
  state.initializePromise = null;
  updateExplorerSnapshot(state);

  state.runtime.log(
    `Explorer: loaded ${state.containersById.size} container(s)`,
  );

  if (state.runtime.isAuthenticated && state.runtime.online) {
    await hydrateRemoteContainers(state);
  }

  if (
    state.containersById.size > 0 ||
    (state.runtime.isAuthenticated && state.runtime.online)
  ) {
    scheduleSync();
  }
}

function ensureExplorerStoreInitialized(
  state: ExplorerStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeExplorerStore(state, scheduleSync).catch(
    (error: unknown) => {
      state.initializePromise = null;

      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    },
  );
}

async function buildOutgoingContainerSync(
  containerState: ContainerState,
  execSql: ExplorerRuntime["execSql"],
  pendingUpdates: PendingUpdateRecord[],
  secretKey: Uint8Array,
) {
  const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
    containerState.record.documentRecipientEnvelopes,
  );
  const encryptionMaterial =
    pendingUpdates.length > 0
      ? await getOrCreateDocumentEncryptionMaterial({
          documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
          execSql,
          recipientPublicKeys: containerState.recipientPublicKeys,
          secretKey,
        })
      : null;
  const outgoingUpdates = encryptionMaterial
    ? await encryptPendingUpdates(
        pendingUpdates,
        containerState.record.accessEpoch,
        encryptionMaterial.documentKey,
      )
    : [];

  return {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates,
  };
}

async function applySyncedContainerUpdates(
  state: ExplorerStoreState,
  containerState: ContainerState,
  synced: NonNullable<
    Awaited<ReturnType<ExplorerRuntime["apiClient"]["syncDocument"]>>
  >,
  currentDocumentRecipientEnvelopes: ReturnType<
    typeof parseDocumentRecipientEnvelopes
  >,
  encryptionMaterial: Awaited<
    ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
  > | null,
  secretKey: Uint8Array,
) {
  containerState.recipientPublicKeys = resolveRecipientPublicKeys(
    synced.recipientEncapsulationPublicKeys,
    getLocalRecipientPublicKeys(state.runtime.encapsulationKeyPair),
  );

  for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
    await deletePendingContainerUpdate(state, acceptedOutgoingUpdateId);
  }

  const nextDocumentRecipientEnvelopes =
    synced.documentRecipientEnvelopes ??
    (encryptionMaterial && currentDocumentRecipientEnvelopes === null
      ? encryptionMaterial.documentRecipientEnvelopes
      : currentDocumentRecipientEnvelopes);
  if (synced.updates.length > 0) {
    if (!nextDocumentRecipientEnvelopes) {
      state.runtime.log(
        `Explorer: skipped metadata updates for container ${containerState.container.id} because the current document key bundle is missing.`,
      );
    } else {
      const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
        documentRecipientEnvelopes: nextDocumentRecipientEnvelopes,
        execSql: state.runtime.execSql,
        recipientPublicKeys: containerState.recipientPublicKeys,
        secretKey,
      });
      const decryptedUpdates = await decryptMetadataUpdates(
        state,
        synced.updates,
        synced.currentAccessEpoch,
        documentKey,
      );
      if (decryptedUpdates.length > 0) {
        importUpdates(containerState.doc, decryptedUpdates);
      }
    }
  }
}

async function syncSingleContainerMetadata(
  state: ExplorerStoreState,
  containerState: ContainerState,
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>,
) {
  const pendingUpdates = await listPendingContainerUpdates(
    state,
    containerState.container.id,
  );
  const documentId = containerState.record.documentId;

  if (!documentId) {
    return;
  }

  const {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates,
  } = await buildOutgoingContainerSync(
    containerState,
    state.runtime.execSql,
    pendingUpdates,
    encapsulationKeyPair.secretKey,
  );

  let synced = await state.runtime.apiClient.syncDocument(
    documentId,
    containerState.record.accessEpoch,
    encodeVersionVector(containerState.doc),
    outgoingUpdates,
    encryptionMaterial && currentDocumentRecipientEnvelopes === null
      ? encryptionMaterial.documentRecipientEnvelopes
      : undefined,
  );

  if (!synced) {
    return;
  }

  synced = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: containerState.record.accessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(containerState.doc),
    recipientPublicKeys: containerState.recipientPublicKeys,
    secretKey: encapsulationKeyPair.secretKey,
    syncDocument: state.runtime.apiClient.syncDocument,
    synced,
  });

  await state.runtime.cacheReferencedPrincipalPolicies(
    synced.referencedPrincipals,
  );

  await applySyncedContainerUpdates(
    state,
    containerState,
    synced,
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    encapsulationKeyPair.secretKey,
  );

  const previousAccessEpoch = containerState.record.accessEpoch;
  await persistContainerState(state, containerState, {
    accessEpoch: synced.currentAccessEpoch,
    documentId,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      synced.documentRecipientEnvelopes ??
        (encryptionMaterial && currentDocumentRecipientEnvelopes === null
          ? encryptionMaterial.documentRecipientEnvelopes
          : currentDocumentRecipientEnvelopes),
    ),
    metadataDocumentId: documentId,
  });

  if (
    pendingUpdates.length > 0 &&
    synced.currentAccessEpoch !== previousAccessEpoch
  ) {
    state.syncRequested = true;
  }
}

async function runExplorerSyncIteration(state: ExplorerStoreState) {
  if (
    !state.snapshot.ready ||
    !state.runtime.online ||
    !state.runtime.isAuthenticated ||
    !state.runtime.encapsulationKeyPair
  ) {
    return;
  }

  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (!encapsulationKeyPair) {
    return;
  }

  for (const containerState of Array.from(state.containersById.values())) {
    await syncSingleContainerMetadata(
      state,
      containerState,
      encapsulationKeyPair,
    );
  }
}

function scheduleExplorerSync(state: ExplorerStoreState) {
  state.syncRequested = true;

  if (state.syncPromise) {
    return;
  }

  state.syncPromise = (async () => {
    while (state.syncRequested) {
      state.syncRequested = false;
      await runExplorerSyncIteration(state);
    }
  })().catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.message === "Database worker client has been destroyed."
    ) {
      return;
    }

    throw error;
  });
  state.syncPromise.finally(() => {
    state.syncPromise = null;
  });
}

function handleExplorerRemoteEvents(
  state: ExplorerStoreState,
  scheduleSync: () => void,
) {
  const knownDocumentIds = new Set(
    Array.from(
      state.containersById.values(),
      (containerState) => containerState.record.documentId,
    ).filter((documentId) => documentId !== null),
  );

  if (knownDocumentIds.size === 0) {
    state.lastEventCount = state.runtime.events.length;
    return;
  }

  const nextEvents = state.runtime.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.events.length;

  if (
    nextEvents.some(
      (event) =>
        isDocumentUpdateCreatedEvent(event) &&
        knownDocumentIds.has(event.documentId),
    )
  ) {
    scheduleSync();
  }
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
      getLocalRecipientPublicKeys(state.runtime.encapsulationKeyPair),
    ),
    record: {
      ...initialRecord,
      accessEpoch: created.metadataAccessEpoch,
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
    documentId: null,
    documentRecipientEnvelopes: null,
    id: childId,
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
    await enqueuePendingContainerUpdate(
      state,
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

function refreshExplorerStore(state: ExplorerStoreState) {
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.initialized ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online
  ) {
    return Promise.resolve(false);
  }

  return requestRemoteHydration(state).then(() => true);
}

async function renameExplorerContainer(
  state: ExplorerStoreState,
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

  await enqueuePendingContainerUpdate(
    state,
    existingState.container.id,
    update,
  );
  await persistContainerState(state, existingState, { name: trimmedName });
  scheduleExplorerSync(state);
  state.runtime.log(`Explorer: renamed container to "${trimmedName}"`);
  return toContainerNode(existingState.container);
}

async function shareExplorerContainerWithUser(
  state: ExplorerStoreState,
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
  if (!existingState?.record.documentId) {
    return null;
  }

  const shared = await state.runtime.apiClient.shareContainer(
    containerId,
    "user",
    userId,
    "write",
  );

  if (!shared) {
    return null;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    shared.metadataReferencedPrincipals,
  );

  existingState.recipientPublicKeys = resolveRecipientPublicKeys(
    shared.metadataRecipientEncapsulationPublicKeys,
    getLocalRecipientPublicKeys(state.runtime.encapsulationKeyPair),
  );
  await persistContainerState(state, existingState, {
    accessEpoch: shared.metadataAccessEpoch,
    documentId: shared.metadataDocumentId,
    metadataDocumentId: shared.metadataDocumentId,
  });

  await enqueuePendingContainerUpdate(
    state,
    containerId,
    exportAllUpdates(existingState.doc),
  );
  await primeNotesForSharedSubtree(state, containerId);
  requestDomainNotesSync(state.runtime.domainScope);
  scheduleExplorerSync(state);
  state.runtime.log(`Explorer: shared container ${containerId} with ${userId}`);
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
  scheduleSync: () => void,
  scheduleHydration: () => void,
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

  ensureExplorerStoreInitialized(state, scheduleSync);

  const regainedSyncPrerequisites =
    (!previousRuntime.online && nextRuntime.online) ||
    (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
    (!previousRuntime.encapsulationKeyPair &&
      !!nextRuntime.encapsulationKeyPair);

  handleExplorerRemoteEvents(state, scheduleSync);

  if (state.snapshot.ready && regainedSyncPrerequisites) {
    scheduleHydration();
  }
}

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
  persistence: ExplorerPersistence = sqlExplorerPersistence,
): ExplorerStore {
  const state = createExplorerStoreState(initialRuntime, persistence);
  const scheduleSync = () => scheduleExplorerSync(state);
  const scheduleHydration = () => scheduleRemoteHydration(state);

  return {
    createChild: (parentId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => createChildContainer(state, parentId, name));
      return state.writeChain;
    },
    deleteContainer: (containerId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => deleteExplorerContainer(state, containerId));
      return state.writeChain.then((deletedNode) => deletedNode !== null);
    },
    refresh: () => refreshExplorerStore(state),
    renameContainer: (containerId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => renameExplorerContainer(state, containerId, name));
      return state.writeChain;
    },
    shareWithUser: (containerId: string, userId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => shareExplorerContainerWithUser(state, containerId, userId));
      return state.writeChain.then((sharedNode) => sharedNode !== null);
    },
    getSnapshot: () => state.snapshot,
    subscribe: (listener) => subscribeToExplorerStore(state, listener),
    updateRuntime: (runtime) =>
      updateExplorerStoreRuntime(
        state,
        runtime,
        scheduleSync,
        scheduleHydration,
      ),
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
    refresh: store.refresh,
    renameContainer: store.renameContainer,
    shareWithUser: store.shareWithUser,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  };
}
