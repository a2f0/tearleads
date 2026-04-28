import { toFingerprint } from "@tearleads/crypto";
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
  createDocumentEncryptionMaterial,
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
  serializeDocumentRecipientEnvelopes,
} from "../../../data/documentSync";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import { sqlDocumentsPersistence } from "../../../data/documents/documentsPersistence";
import {
  type DocumentV2CreateAuthor,
  syncRemoteDocumentV2,
} from "../../../data/documents/documentV2Runtime";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../../data/persistence/documentPersistence";
import type { ExecSql } from "../../../data/persistence/sqlSchema";
import {
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../../data/sync/syncCoordinator";
import type {
  ContainerCreateIntentRecord,
  ExplorerPersistence,
} from "../explorerPersistence";

type ExplorerAppData = ReturnType<typeof useAppData>;

export type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
type ListedRemoteContainer = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["listContainers"]>>
>[number];
type MovedRemoteContainer = NonNullable<
  Awaited<ReturnType<ExplorerRuntime["apiClient"]["moveContainer"]>>
>;
type ContainerMetadataEncryptionMaterial = Awaited<
  ReturnType<typeof createDocumentEncryptionMaterial>
>;
type ExplorerRuntimeV2Api = Pick<
  ExplorerAppData["apiClient"],
  "getDocumentV2WriterProjection" | "syncDocumentV2"
>;

interface ContainerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: NonNullable<Awaited<ReturnType<typeof syncRemoteDocumentV2>>>;
}

export interface ExplorerRuntime {
  apiClient: Pick<
    ExplorerAppData["apiClient"],
    | "createContainer"
    | "getEncapsulationKey"
    | "getBlob"
    | "listContainers"
    | "listDocumentAttachments"
    | "moveContainer"
    | "shareContainer"
  > &
    Partial<
      Pick<
        ExplorerAppData["apiClient"],
        "commitDocumentChange" | "createDocument" | "stageBlob"
      >
    > &
    Partial<
      Pick<
        ExplorerAppData["apiClient"],
        | "createDocumentV2"
        | "getContainerV2WriterProjection"
        | "getDocumentV2WriterProjection"
        | "syncDocumentV2"
      >
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
  organizationId?: ExplorerAppData["organizationId"];
  signingFingerprint?: ExplorerAppData["signingFingerprint"];
  signingKeyPair?: ExplorerAppData["signingKeyPair"];
  userId?: ExplorerAppData["userId"];
}

export interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord;
}

export interface ExplorerContainerPatch {
  accessEpoch: number;
  accessStateHash: string | null;
  documentId: string | null;
  documentRecipientEnvelopes: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  loroSnapshot: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  v2ContentKeyBundle: string | null;
  v2DocumentKekTargets: string | null;
  v2DocumentManifestBundle: string | null;
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
  syncLane: SyncLane | null;
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

function requestExplorerSync(state: ExplorerSyncState) {
  state.syncLane?.requestSync();
}

export function getFallbackContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

function buildNotesRuntime(state: ExplorerSyncState, containerId: string) {
  const { apiClient } = state.runtime;
  return {
    apiClient: {
      ...(apiClient.createDocumentV2
        ? {
            createDocumentV2: apiClient.createDocumentV2.bind(apiClient),
          }
        : {}),
      ...(apiClient.getContainerV2WriterProjection
        ? {
            getContainerV2WriterProjection:
              apiClient.getContainerV2WriterProjection.bind(apiClient),
          }
        : {}),
      ...(apiClient.getDocumentV2WriterProjection
        ? {
            getDocumentV2WriterProjection:
              apiClient.getDocumentV2WriterProjection.bind(apiClient),
          }
        : {}),
      getBlob: (blobId: string) => state.runtime.apiClient.getBlob(blobId),
      listContainers: () => state.runtime.apiClient.listContainers(),
      listDocumentAttachments: (documentId: string) =>
        state.runtime.apiClient.listDocumentAttachments(documentId),
      ...(apiClient.syncDocumentV2
        ? {
            syncDocumentV2: apiClient.syncDocumentV2.bind(apiClient),
          }
        : {}),
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
    organizationId: state.runtime.organizationId ?? null,
    signingFingerprint: state.runtime.signingFingerprint ?? null,
    signingKeyPair: state.runtime.signingKeyPair ?? null,
    userId: state.runtime.userId ?? null,
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
        accessStateHash: remoteContainer.metadataAccessStateHash,
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
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      documentRecipientEnvelopes: null,
      id: remoteContainer.id,
      lastCommitLsn: null,
      loroSnapshot: initialSnapshot,
      v2ContentKeyBundle: null,
      v2DocumentKekTargets: null,
      v2DocumentManifestBundle: null,
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
      if (isDestroyedDatabaseClientError(error)) {
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
        accessStateHash: null,
        documentId: container.metadataDocumentId,
        documentRecipientEnvelopes: null,
        id: container.id,
        lastCommitLsn: null,
        loroSnapshot: bytesToBase64(initialUpdate),
        v2ContentKeyBundle: null,
        v2DocumentKekTargets: null,
        v2DocumentManifestBundle: null,
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

    if (isDestroyedDatabaseClientError(error)) {
      return;
    }

    throw error;
  });
}

function resolveExplorerV2Author(
  runtime: ExplorerRuntime,
): DocumentV2CreateAuthor | null {
  if (
    !runtime.organizationId ||
    !runtime.signingFingerprint ||
    !runtime.signingKeyPair ||
    !runtime.userId
  ) {
    return null;
  }

  return {
    organizationId: runtime.organizationId,
    signerDeviceId: `signing-key:${runtime.signingFingerprint}`,
    signerKeyFingerprint: runtime.signingFingerprint,
    signerPrivateKey: runtime.signingKeyPair.signingPrivateKey,
    signerUserId: runtime.userId,
  };
}

function resolveExplorerV2Api(
  runtime: ExplorerRuntime,
): ExplorerRuntimeV2Api | null {
  const { apiClient } = runtime;
  if (!apiClient.getDocumentV2WriterProjection || !apiClient.syncDocumentV2) {
    return null;
  }

  return {
    getDocumentV2WriterProjection:
      apiClient.getDocumentV2WriterProjection.bind(apiClient),
    syncDocumentV2: apiClient.syncDocumentV2.bind(apiClient),
  };
}

function createExplorerWriterPublicKeyResolver(state: ExplorerSyncState) {
  const cache = new Map<string, Promise<Uint8Array | null>>();

  return async (input: {
    authorFingerprint: string;
    header: { writerKeyFingerprint: string; writerUserId: string };
  }): Promise<Uint8Array | null> => {
    const { authorFingerprint, header } = input;
    if (header.writerKeyFingerprint !== authorFingerprint) {
      return null;
    }

    const cacheKey = `${header.writerUserId}:${authorFingerprint}`;
    let cached = cache.get(cacheKey);
    if (!cached) {
      cached = state.runtime.apiClient
        .getEncapsulationKey(header.writerUserId)
        .then(async (response) => {
          if (!response) {
            return null;
          }

          const signingPublicKey = base64ToBytes(response.signingPublicKey);
          const signingKeyFingerprint = await toFingerprint(signingPublicKey);
          if (
            signingKeyFingerprint !== response.signingKeyFingerprint ||
            signingKeyFingerprint !== authorFingerprint
          ) {
            state.runtime.log(
              `Explorer: skipped metadata writer key for ${header.writerUserId} because the signing fingerprint does not match the public key.`,
            );
            return null;
          }

          return signingPublicKey;
        })
        .catch(() => {
          state.runtime.log(
            `Explorer: skipped metadata writer key for ${header.writerUserId} because it could not be loaded.`,
          );
          return null;
        });
      cache.set(cacheKey, cached);
    }

    return cached;
  };
}

async function applySyncedContainerUpdates(input: {
  containerState: ContainerState;
  state: ExplorerSyncState;
  synced: NonNullable<Awaited<ReturnType<typeof syncRemoteDocumentV2>>>;
}) {
  const { containerState, state, synced } = input;

  for (const acceptedOutgoingUpdateId of synced.response
    .acceptedOutgoingUpdateIds) {
    await deletePendingContainerUpdate(state, acceptedOutgoingUpdateId);
  }

  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      containerState.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
  }
}

async function requestContainerMetadataSync(
  state: ExplorerSyncState,
  containerState: ContainerState,
  encapsulationKeyPair: NonNullable<ExplorerRuntime["encapsulationKeyPair"]>,
): Promise<ContainerMetadataSyncAttempt | null> {
  const documentId = containerState.record.documentId;

  if (!documentId) {
    return null;
  }

  const pendingUpdates = await listPendingContainerUpdates(
    state,
    containerState.container.id,
  );

  const author = resolveExplorerV2Author(state.runtime);
  const apiClient = resolveExplorerV2Api(state.runtime);
  if (!author || !apiClient) {
    state.runtime.log(
      "Explorer: skipped V2 metadata sync because the V2 writer context is unavailable.",
    );
    return null;
  }

  const synced = await syncRemoteDocumentV2({
    apiClient,
    author,
    documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(containerState.doc),
    minLsn: containerState.record.lastCommitLsn ?? undefined,
    pendingUpdates,
    resolveWriterPublicKey: createExplorerWriterPublicKeyResolver(state),
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
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

  const { outgoingUpdateCount, synced } = syncAttempt;

  await applySyncedContainerUpdates({
    containerState,
    state,
    synced,
  });

  await host.persistContainerState(containerState, {
    ...synced.persistedState,
    documentId: containerState.record.documentId,
    documentRecipientEnvelopes: null,
    lastCommitLsn:
      synced.response.commitLsn ?? containerState.record.lastCommitLsn ?? null,
    metadataDocumentId: containerState.record.documentId,
  });

  if (outgoingUpdateCount > synced.response.acceptedOutgoingUpdateIds.length) {
    requestExplorerSync(state);
  }
}

function hasRemoteMetadataState(containerState: ContainerState): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}

function createCurrentMetadataPendingRecord(
  containerState: ContainerState,
): PendingUpdateRecord[] {
  const updateFields = createPendingUpdateFields(
    exportAllUpdates(containerState.doc),
  );

  return updateFields
    ? [
        {
          id: crypto.randomUUID(),
          ...updateFields,
        },
      ]
    : [];
}

async function markCreateIntentAlreadySynced(input: {
  intent: ContainerCreateIntentRecord;
  state: ExplorerSyncState;
  containerState: ContainerState;
}) {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return;
  }

  await state.persistence.markCreateIntentSynced(state.runtime.execSql, {
    containerId: intent.containerId,
    remoteContainerId: containerState.container.id,
    remoteMetadataAccessStateHash,
    remoteMetadataDocumentId,
  });
}

async function persistCreatedContainerFromIntent(input: {
  created: NonNullable<
    Awaited<ReturnType<ExplorerRuntime["apiClient"]["createContainer"]>>
  >;
  documentRecipientEnvelopes: ContainerMetadataEncryptionMaterial["documentRecipientEnvelopes"];
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
}) {
  const { containerState, created, documentRecipientEnvelopes, host, state } =
    input;

  containerState.recipientPublicKeys = resolveRecipientPublicKeys(
    created.metadataRecipientEncapsulationPublicKeys,
  );
  const nextRecord = await host.persistContainerState(
    containerState,
    {
      accessEpoch: created.metadataAccessEpoch,
      accessStateHash: created.metadataAccessStateHash,
      documentId: created.metadataDocumentId,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        documentRecipientEnvelopes,
      ),
      lastCommitLsn: null,
      metadataDocumentId: created.metadataDocumentId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      v2ContentKeyBundle: null,
      v2DocumentKekTargets: null,
      v2DocumentManifestBundle: null,
    },
    false,
  );

  containerState.record = nextRecord;
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: created.metadataDocumentId,
    organizationId: created.organizationId,
    parentId: created.parentId,
  };

  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    containerState.container.id,
  );
  await state.persistence.markCreateIntentSynced(state.runtime.execSql, {
    containerId: containerState.container.id,
    remoteContainerId: created.id,
    remoteMetadataAccessStateHash: created.metadataAccessStateHash,
    remoteMetadataDocumentId: created.metadataDocumentId,
  });
}

async function tryCreateRemoteContainerFromIntent(input: {
  host: ExplorerSyncHost;
  intent: ContainerCreateIntentRecord;
  state: ExplorerSyncState;
}): Promise<"created" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    await state.persistence.recordCreateIntentError(
      state.runtime.execSql,
      intent.containerId,
      "Container create intent references a missing local container",
    );
    return "failed";
  }

  if (hasRemoteMetadataState(containerState)) {
    await markCreateIntentAlreadySynced({ containerState, intent, state });
    return "created";
  }

  if (!hasRemoteMetadataState(parentState)) {
    return "blocked";
  }
  const expectedAccessStateHash = parentState.record.accessStateHash;
  if (
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    return "blocked";
  }

  if (parentState.recipientPublicKeys.length === 0) {
    await state.persistence.recordCreateIntentError(
      state.runtime.execSql,
      intent.containerId,
      "Parent container recipient keys are unavailable",
    );
    return "failed";
  }

  const documentEncryption = await createDocumentEncryptionMaterial(
    parentState.recipientPublicKeys,
  );
  const initialMetadataUpdates = await encryptPendingUpdates(
    createCurrentMetadataPendingRecord(containerState),
    containerState.record.accessEpoch,
    documentEncryption.documentKey,
  );
  const created = await state.runtime.apiClient.createContainer(
    containerState.container.id,
    parentState.container.id,
    expectedAccessStateHash,
    initialMetadataUpdates,
    documentEncryption.documentRecipientEnvelopes,
  );

  if (!created) {
    await state.persistence.recordCreateIntentError(
      state.runtime.execSql,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    created.metadataReferencedPrincipals,
  );
  await persistCreatedContainerFromIntent({
    containerState,
    created,
    documentRecipientEnvelopes: documentEncryption.documentRecipientEnvelopes,
    host,
    state,
  });
  state.runtime.log(
    `Explorer: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

async function syncPendingContainerCreateIntents(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): Promise<number> {
  const { host, state } = input;
  const pendingIntents = await state.persistence.listPendingCreateIntents(
    state.runtime.execSql,
  );
  const remainingContainerIds = new Set(
    pendingIntents.map((intent) => intent.containerId),
  );
  const failedThisRun = new Set<string>();
  let createdCount = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const intent of pendingIntents) {
      if (
        !remainingContainerIds.has(intent.containerId) ||
        failedThisRun.has(intent.containerId)
      ) {
        continue;
      }

      const result = await tryCreateRemoteContainerFromIntent({
        host,
        intent,
        state,
      });

      if (result === "blocked") {
        continue;
      }

      remainingContainerIds.delete(intent.containerId);
      progressed = result === "created" || progressed;
      if (result === "created") {
        createdCount += 1;
      } else {
        failedThisRun.add(intent.containerId);
      }
    }
  }

  return createdCount;
}

async function runExplorerSyncIteration(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}) {
  const { host, state } = input;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (
    state.runtime.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.online ||
    !state.runtime.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    state,
  });
  if (createdContainerCount > 0) {
    host.updateSnapshot();
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

function createRemoteContainerIngestor(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): (remoteContainer: ExplorerRemoteContainer) => Promise<void> {
  const { host, state } = input;
  const pendingRemoteContainersById = new Map<
    string,
    ExplorerRemoteContainer
  >();
  let ingestRemoteContainersPromise: Promise<void> | null = null;

  return async (remoteContainer: ExplorerRemoteContainer) => {
    pendingRemoteContainersById.set(remoteContainer.id, remoteContainer);

    if (ingestRemoteContainersPromise) {
      return ingestRemoteContainersPromise;
    }

    ingestRemoteContainersPromise = Promise.resolve()
      .then(async () => {
        while (pendingRemoteContainersById.size > 0) {
          const queuedRemoteContainers = Array.from(
            pendingRemoteContainersById.values(),
          );
          pendingRemoteContainersById.clear();

          await state.runtime.cacheReferencedPrincipalPolicies(
            queuedRemoteContainers.flatMap(
              (queuedRemoteContainer) =>
                queuedRemoteContainer.metadataReferencedPrincipals ?? [],
            ),
          );

          for (const queuedRemoteContainer of queuedRemoteContainers) {
            await upsertRemoteContainerState(
              state,
              host,
              queuedRemoteContainer,
            );
          }

          host.updateSnapshot();
        }
      })
      .finally(() => {
        ingestRemoteContainersPromise = null;
      });

    return ingestRemoteContainersPromise;
  };
}

export function createExplorerSyncAgent(input: {
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
}): ExplorerSyncAgent {
  const { host, state } = input;

  state.syncLane = getOrCreateDomainSyncCoordinator(
    state.runtime.domainScope,
  ).registerLane("explorer", {
    run: () => runExplorerSyncIteration({ host, state }),
    shouldIgnoreError: isDestroyedDatabaseClientError,
  });
  const scheduleSync = () => requestExplorerSync(state);
  const ingestRemoteContainer = createRemoteContainerIngestor({ host, state });

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
    ingestRemoteContainer,
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
