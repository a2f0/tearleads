import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import type { useAppData } from "../../../data/AppDataProvider";
import type { BlobStore } from "../../../data/blobs";
import {
  type ContainerRecord,
  createContainerMetadataDocument,
  readContainerMetadataValue,
  sqlDocumentContainerProjectionPersistence,
  writeContainerMetadataValue,
} from "../../../data/containers";
import {
  createPendingUpdateFields,
  decryptIncomingUpdates,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  getOrCreateDocumentEncryptionMaterial,
  isDocumentUpdateCreatedEvent,
  maybeSeedRewrappedDocumentRecipientEnvelopes,
  parseDocumentRecipientEnvelopes,
  requiresBaselineAfterDocumentEpochChange,
  resolveIncomingUpdateDecryptionBatches,
  resolveRecipientPublicKeys,
  resolveSyncedDocumentRecipientEnvelopes,
  serializeDocumentRecipientEnvelopes,
} from "../../../data/documentSync";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import { sqlDocumentsPersistence } from "../../../data/documents/documentsPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../../data/persistence/documentPersistence";
import type { ExecSql } from "../../../data/persistence/sqlSchema";
import type { ExplorerPersistence } from "../explorerPersistence";

type ExplorerAppData = ReturnType<typeof useAppData>;

export type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
type ListedRemoteContainer = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["listContainers"]>>
>[number];
type CommitDocumentChangeInput = Parameters<
  ExplorerRuntime["apiClient"]["commitDocumentChange"]
>[1];
type MovedRemoteContainer = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["moveContainer"]>>
>;
type StageBlobInput = Parameters<ExplorerRuntime["apiClient"]["stageBlob"]>[0];
type SyncDocumentOutgoingUpdates = Parameters<
  ExplorerRuntime["apiClient"]["syncDocument"]
>[3];
type SyncDocumentRecipientEnvelopes = Parameters<
  ExplorerRuntime["apiClient"]["syncDocument"]
>[4];
type DocumentRecipientEnvelopes = ReturnType<
  typeof parseDocumentRecipientEnvelopes
>;
type DocumentEncryptionMaterial = Awaited<
  ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
>;
type ExplorerSyncDocumentResponse = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["syncDocument"]>>
>;

interface ContainerMetadataSyncAttempt {
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  encryptionMaterial: DocumentEncryptionMaterial | null;
  outgoingUpdates: SyncDocumentOutgoingUpdates;
  synced: ExplorerSyncDocumentResponse;
}

export interface ExplorerRuntime {
  apiClient: Pick<
    ExplorerAppData["apiClient"],
    | "commitDocumentChange"
    | "createContainer"
    | "createDocument"
    | "getBlob"
    | "listContainers"
    | "listDocumentAttachments"
    | "moveContainer"
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

export interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord;
}

export interface ExplorerContainerPatch {
  accessEpoch: number;
  documentId: string | null;
  documentRecipientEnvelopes: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  loroSnapshot: string;
  name: string;
  organizationId: string;
  parentId: string | null;
}

export interface ExplorerSyncState {
  containersById: Map<string, ContainerState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  persistence: ExplorerPersistence;
  remoteHydrationPromise: Promise<void> | null;
  runtime: ExplorerRuntime;
  snapshot: {
    ready: boolean;
  };
  syncPromise: Promise<void> | null;
  syncRequested: boolean;
}

export type ExplorerRemoteContainer =
  | ListedRemoteContainer
  | MovedRemoteContainer;

export interface ExplorerSyncAgent {
  enqueuePendingContainerUpdate: (
    containerId: string,
    update: Uint8Array,
    sourceVersionVector?: string | null,
  ) => Promise<void>;
  ensureInitialized: () => void;
  handleRemoteEvents: () => void;
  ingestRemoteContainer: (
    remoteContainer: ExplorerRemoteContainer,
  ) => Promise<void>;
  primeDocumentsForSharedSubtree: (rootContainerId: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  requestRemoteHydration: () => Promise<void>;
  scheduleRemoteHydration: () => void;
  scheduleSync: () => void;
}

interface ExplorerSyncHost {
  persistContainerState: (
    containerState: ContainerState,
    patch?: Partial<ExplorerContainerPatch>,
    updateView?: boolean,
  ) => Promise<DocumentRecord>;
  updateSnapshot: () => void;
}

export function getFallbackContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

function buildNotesRuntime(state: ExplorerSyncState, containerId: string) {
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
        minLsn?: string,
      ) =>
        state.runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
          minLsn,
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

function resolveSharedDocumentRuntimeContainerId(params: {
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  documentSummary: {
    containerId: string | null;
    documentId: string | null;
  };
  sharedContainerIds: ReadonlySet<string>;
}): string | null {
  const {
    linkedContainerIdsByDocumentId,
    documentSummary,
    sharedContainerIds,
  } = params;
  if (
    documentSummary.containerId &&
    sharedContainerIds.has(documentSummary.containerId)
  ) {
    return documentSummary.containerId;
  }

  if (!documentSummary.documentId) {
    return null;
  }

  return (
    linkedContainerIdsByDocumentId
      .get(documentSummary.documentId)
      ?.find((containerId) => sharedContainerIds.has(containerId)) ?? null
  );
}

function isContainerInSubtree(
  containersById: ReadonlyMap<string, ContainerState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentId: string | null = containerId;

  while (currentId !== null) {
    if (currentId === rootContainerId) {
      return true;
    }

    currentId = containersById.get(currentId)?.container.parentId ?? null;
  }

  return false;
}

async function primeDocumentsForSharedSubtree(
  state: ExplorerSyncState,
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

  await sqlDocumentsPersistence.ensureSchema(state.runtime.execSql);
  const sharedContainerIdList = Array.from(sharedContainerIds);
  const sharedDocumentIds =
    await sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
      state.runtime.execSql,
      sharedContainerIdList,
    );
  const documentSummaries =
    await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
      state.runtime.execSql,
      {
        containerIds: sharedContainerIdList,
        documentIds: sharedDocumentIds,
      },
    );
  const documentIds = Array.from(
    new Set(
      documentSummaries.flatMap((documentSummary) =>
        documentSummary.documentId ? [documentSummary.documentId] : [],
      ),
    ),
  );
  const linkedContainerIdsByDocumentId =
    await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
      state.runtime.execSql,
      documentIds,
    );

  for (const documentSummary of documentSummaries) {
    const runtimeContainerId = resolveSharedDocumentRuntimeContainerId({
      linkedContainerIdsByDocumentId,
      documentSummary,
      sharedContainerIds,
    });
    if (!runtimeContainerId) {
      continue;
    }

    const documentStore = primeDocumentStore(
      state.runtime.domainScope,
      documentSummary.id,
      buildNotesRuntime(state, runtimeContainerId),
      undefined,
      documentSummary.documentId,
    );
    documentStore.requestSync();
  }
}

async function listPendingContainerUpdates(
  state: ExplorerSyncState,
  containerId: string,
): Promise<PendingUpdateRecord[]> {
  return state.persistence.listPendingUpdates(
    state.runtime.execSql,
    containerId,
  );
}

async function enqueuePendingContainerUpdate(
  state: ExplorerSyncState,
  containerId: string,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  const pendingUpdateFields = createPendingUpdateFields(
    update,
    sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await state.persistence.enqueuePendingUpdate(state.runtime.execSql, {
    containerId,
    ...pendingUpdateFields,
  });
}

async function deletePendingContainerUpdate(
  state: ExplorerSyncState,
  id: string,
) {
  await state.persistence.deletePendingUpdate(state.runtime.execSql, id);
}

async function replacePendingContainerUpdatesWithBaseline(
  state: ExplorerSyncState,
  containerState: ContainerState,
  sourceVersionVector?: string | null,
) {
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    containerState.container.id,
  );
  await enqueuePendingContainerUpdate(
    state,
    containerState.container.id,
    exportAllUpdates(containerState.doc),
    sourceVersionVector,
  );
}

async function decryptMetadataUpdates(
  state: ExplorerSyncState,
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

async function upsertRemoteContainerState(
  state: ExplorerSyncState,
  host: ExplorerSyncHost,
  remoteContainer: ExplorerRemoteContainer,
): Promise<ContainerState> {
  const existingState = state.containersById.get(remoteContainer.id);

  if (existingState) {
    existingState.recipientPublicKeys = resolveRecipientPublicKeys(
      remoteContainer.metadataRecipientEncapsulationPublicKeys,
    );
    await host.persistContainerState(
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
    return existingState;
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
    ),
    record: {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      documentId: remoteContainer.metadataDocumentId,
      documentRecipientEnvelopes: null,
      id: remoteContainer.id,
      lastCommitLsn: null,
      loroSnapshot: initialSnapshot,
    },
  };

  await state.persistence.saveContainer(
    state.runtime.execSql,
    containerState.container,
    containerState.record,
  );
  state.containersById.set(remoteContainer.id, containerState);
  return containerState;
}

async function hydrateRemoteContainers(
  state: ExplorerSyncState,
  host: ExplorerSyncHost,
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

  for (const remoteContainer of remoteContainers) {
    await upsertRemoteContainerState(state, host, remoteContainer);
  }

  if (remoteContainers.length > 0) {
    host.updateSnapshot();
    state.runtime.log(
      `Explorer: hydrated ${remoteContainers.length} remote container(s)`,
    );
  }
}

function requestRemoteHydration(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}): Promise<void> {
  const { host, scheduleSync, state } = input;
  if (state.remoteHydrationPromise) {
    return state.remoteHydrationPromise;
  }

  state.remoteHydrationPromise = hydrateRemoteContainers(state, host)
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
        scheduleSync();
      }
    });

  return state.remoteHydrationPromise;
}

async function initializeExplorerStore(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}) {
  const { host, scheduleSync, state } = input;
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
        lastCommitLsn: null,
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
  host.updateSnapshot();

  state.runtime.log(
    `Explorer: loaded ${state.containersById.size} container(s)`,
  );

  if (state.runtime.isAuthenticated && state.runtime.online) {
    await hydrateRemoteContainers(state, host);
  }

  if (
    state.containersById.size > 0 ||
    (state.runtime.isAuthenticated && state.runtime.online)
  ) {
    scheduleSync();
  }
}

function ensureExplorerStoreInitialized(input: {
  host: ExplorerSyncHost;
  scheduleSync: () => void;
  state: ExplorerSyncState;
}) {
  const { host, scheduleSync, state } = input;
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeExplorerStore({
    host,
    scheduleSync,
    state,
  }).catch((error: unknown) => {
    state.initializePromise = null;

    if (
      error instanceof Error &&
      error.message === "Database worker client has been destroyed."
    ) {
      return;
    }

    throw error;
  });
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

async function applySyncedContainerUpdates(input: {
  containerState: ContainerState;
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  encryptionMaterial: DocumentEncryptionMaterial | null;
  secretKey: Uint8Array;
  state: ExplorerSyncState;
  synced: ExplorerSyncDocumentResponse;
}) {
  const {
    containerState,
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    secretKey,
    state,
    synced,
  } = input;
  containerState.recipientPublicKeys = resolveRecipientPublicKeys(
    synced.recipientEncapsulationPublicKeys,
  );

  for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
    await deletePendingContainerUpdate(state, acceptedOutgoingUpdateId);
  }

  const previousAccessEpoch = containerState.record.accessEpoch;
  const nextDocumentRecipientEnvelopes =
    resolveSyncedDocumentRecipientEnvelopes({
      currentAccessEpoch: previousAccessEpoch,
      currentDocumentRecipientEnvelopes,
      generatedDocumentRecipientEnvelopes:
        encryptionMaterial?.documentRecipientEnvelopes ?? null,
      synced,
    });
  if (synced.updates.length > 0) {
    const decryptionBatches = resolveIncomingUpdateDecryptionBatches({
      currentDocumentRecipientEnvelopes,
      nextDocumentRecipientEnvelopes,
      previousAccessEpoch,
      synced,
    });

    if (decryptionBatches.length === 0) {
      state.runtime.log(
        `Explorer: skipped metadata updates for container ${containerState.container.id} because the current document key bundle is missing.`,
      );
    } else {
      for (const decryptionBatch of decryptionBatches) {
        const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
          documentRecipientEnvelopes:
            decryptionBatch.documentRecipientEnvelopes,
          execSql: state.runtime.execSql,
          recipientPublicKeys: containerState.recipientPublicKeys,
          secretKey,
        });
        const decryptedUpdates = await decryptMetadataUpdates(
          state,
          decryptionBatch.updates,
          decryptionBatch.accessEpoch,
          documentKey,
        );
        if (decryptedUpdates.length > 0) {
          importUpdates(containerState.doc, decryptedUpdates);
        }
      }
    }
  }
}

async function handleSyncedContainerEpochChange(input: {
  containerState: ContainerState;
  nextDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  previousAccessEpoch: number;
  state: ExplorerSyncState;
  synced: ExplorerSyncDocumentResponse;
}) {
  if (input.synced.currentAccessEpoch === input.previousAccessEpoch) {
    return;
  }

  if (
    requiresBaselineAfterDocumentEpochChange({
      previousAccessEpoch: input.previousAccessEpoch,
      resolvedDocumentRecipientEnvelopes: input.nextDocumentRecipientEnvelopes,
      synced: input.synced,
    })
  ) {
    await replacePendingContainerUpdatesWithBaseline(
      input.state,
      input.containerState,
      input.synced.documentRecipientEnvelopeAction === "rotate"
        ? input.synced.rotateBaselineSourceVersionVector
        : null,
    );
  }
  input.state.syncRequested = true;
}

async function requestContainerMetadataSync(
  state: ExplorerSyncState,
  containerState: ContainerState,
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>,
): Promise<ContainerMetadataSyncAttempt | null> {
  const pendingUpdates = await listPendingContainerUpdates(
    state,
    containerState.container.id,
  );
  const documentId = containerState.record.documentId;

  if (!documentId) {
    return null;
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
    containerState.record.lastCommitLsn ?? undefined,
  );

  if (!synced) {
    return null;
  }

  synced = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: containerState.record.accessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(containerState.doc),
    minLsn: containerState.record.lastCommitLsn ?? undefined,
    recipientPublicKeys: containerState.recipientPublicKeys,
    secretKey: encapsulationKeyPair.secretKey,
    syncDocument: state.runtime.apiClient.syncDocument.bind(
      state.runtime.apiClient,
    ),
    synced,
  });

  return {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    synced,
    outgoingUpdates,
  };
}

async function syncSingleContainerMetadata(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>;
}) {
  const { containerState, encapsulationKeyPair, host, state } = input;
  const syncAttempt = await requestContainerMetadataSync(
    state,
    containerState,
    encapsulationKeyPair,
  );
  if (!syncAttempt) {
    return;
  }

  const {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates,
    synced,
  } = syncAttempt;

  await state.runtime.cacheReferencedPrincipalPolicies(
    synced.referencedPrincipals,
  );

  await applySyncedContainerUpdates({
    containerState,
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    secretKey: encapsulationKeyPair.secretKey,
    state,
    synced,
  });

  const previousAccessEpoch = containerState.record.accessEpoch;
  const nextDocumentRecipientEnvelopes =
    resolveSyncedDocumentRecipientEnvelopes({
      currentAccessEpoch: previousAccessEpoch,
      currentDocumentRecipientEnvelopes,
      generatedDocumentRecipientEnvelopes:
        encryptionMaterial?.documentRecipientEnvelopes ?? null,
      synced,
    });
  await host.persistContainerState(containerState, {
    accessEpoch: synced.currentAccessEpoch,
    documentId: containerState.record.documentId,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      nextDocumentRecipientEnvelopes,
    ),
    lastCommitLsn:
      synced.commitLsn ?? containerState.record.lastCommitLsn ?? null,
    metadataDocumentId: containerState.record.documentId,
  });

  await handleSyncedContainerEpochChange({
    containerState,
    nextDocumentRecipientEnvelopes,
    previousAccessEpoch,
    state,
    synced,
  });

  if (
    synced.canonicalDocumentRecipientEnvelopesAdopted ||
    outgoingUpdates.length > synced.acceptedOutgoingUpdateIds.length
  ) {
    state.syncRequested = true;
  }
}

async function runExplorerSyncIteration(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}) {
  const { host, state } = input;
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
    await syncSingleContainerMetadata({
      containerState,
      encapsulationKeyPair,
      host,
      state,
    });
  }
}

export function createExplorerSyncAgent(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): ExplorerSyncAgent {
  const { host, state } = input;

  const scheduleSync = () => {
    state.syncRequested = true;

    if (state.syncPromise) {
      return;
    }

    state.syncPromise = (async () => {
      while (state.syncRequested) {
        state.syncRequested = false;
        await runExplorerSyncIteration({ host, state });
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
  };

  const requestHydration = () =>
    requestRemoteHydration({ host, scheduleSync, state });

  return {
    enqueuePendingContainerUpdate: (
      containerId: string,
      update: Uint8Array,
      sourceVersionVector?: string | null,
    ) =>
      enqueuePendingContainerUpdate(
        state,
        containerId,
        update,
        sourceVersionVector,
      ),
    ensureInitialized: () =>
      ensureExplorerStoreInitialized({ host, scheduleSync, state }),
    handleRemoteEvents: () => {
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
    },
    ingestRemoteContainer: async (remoteContainer: ExplorerRemoteContainer) => {
      await state.runtime.cacheReferencedPrincipalPolicies(
        remoteContainer.metadataReferencedPrincipals ?? [],
      );
      await upsertRemoteContainerState(state, host, remoteContainer);
      host.updateSnapshot();
    },
    primeDocumentsForSharedSubtree: (rootContainerId: string) =>
      primeDocumentsForSharedSubtree(state, rootContainerId),
    refresh: () => {
      if (
        state.runtime.dbStatus !== "ready" ||
        !state.initialized ||
        !state.runtime.isAuthenticated ||
        !state.runtime.online
      ) {
        return Promise.resolve(false);
      }

      return requestHydration().then(() => true);
    },
    requestRemoteHydration: requestHydration,
    scheduleRemoteHydration: () => {
      void requestHydration();
    },
    scheduleSync,
  };
}
