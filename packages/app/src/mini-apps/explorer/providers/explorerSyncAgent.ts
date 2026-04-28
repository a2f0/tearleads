import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { useAppData } from "../../../data/AppDataProvider";
import type { BlobStore } from "../../../data/blobs";
import {
  type ContainerRecord,
  createContainerMetadataDocument,
  createRemoteContainerV2,
  moveRemoteContainerV2,
  readContainerMetadataValue,
  shareRemoteContainerV2,
  sqlDocumentContainerProjectionPersistence,
  writeContainerMetadataValue,
} from "../../../data/containers";
import {
  createPendingUpdateFields,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../../data/documentSync";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import { sqlDocumentsPersistence } from "../../../data/documents/documentsPersistence";
import { createDocumentV2SignerDeviceId } from "../../../data/documents/documentV2Constants";
import {
  createRemoteDocumentV2,
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
type ExplorerRuntimeV2Api = Pick<
  ExplorerAppData["apiClient"],
  "getDocumentV2WriterProjection" | "syncDocumentV2"
>;
type ExplorerRuntimeV2CreateApi = Pick<
  ExplorerAppData["apiClient"],
  "createContainerV2" | "createDocumentV2" | "getContainerV2WriterProjection"
>;
type ExplorerRuntimeV2ShareApi = Pick<
  ExplorerAppData["apiClient"],
  "getContainerV2WriterProjection" | "shareContainerV2"
>;
type ExplorerRuntimeV2MoveApi = Pick<
  ExplorerAppData["apiClient"],
  "getContainerV2WriterProjection" | "moveContainerV2"
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
        | "createContainerV2"
        | "createDocumentV2"
        | "getContainerV2WriterProjection"
        | "getDocumentV2WriterProjection"
        | "moveContainerV2"
        | "shareContainerV2"
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
    signerDeviceId: createDocumentV2SignerDeviceId(runtime.signingFingerprint),
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

function resolveExplorerV2CreateApi(
  runtime: ExplorerRuntime,
): ExplorerRuntimeV2CreateApi | null {
  const { apiClient } = runtime;
  if (
    !apiClient.createContainerV2 ||
    !apiClient.createDocumentV2 ||
    !apiClient.getContainerV2WriterProjection
  ) {
    return null;
  }

  return {
    createContainerV2: apiClient.createContainerV2.bind(apiClient),
    createDocumentV2: apiClient.createDocumentV2.bind(apiClient),
    getContainerV2WriterProjection:
      apiClient.getContainerV2WriterProjection.bind(apiClient),
  };
}

function resolveExplorerV2ShareApi(
  runtime: ExplorerRuntime,
): ExplorerRuntimeV2ShareApi | null {
  const { apiClient } = runtime;
  if (
    !apiClient.getContainerV2WriterProjection ||
    !apiClient.shareContainerV2
  ) {
    return null;
  }

  return {
    getContainerV2WriterProjection:
      apiClient.getContainerV2WriterProjection.bind(apiClient),
    shareContainerV2: apiClient.shareContainerV2.bind(apiClient),
  };
}

function resolveExplorerV2MoveApi(
  runtime: ExplorerRuntime,
): ExplorerRuntimeV2MoveApi | null {
  const { apiClient } = runtime;
  if (!apiClient.getContainerV2WriterProjection || !apiClient.moveContainerV2) {
    return null;
  }

  return {
    getContainerV2WriterProjection:
      apiClient.getContainerV2WriterProjection.bind(apiClient),
    moveContainerV2: apiClient.moveContainerV2.bind(apiClient),
  };
}

export async function createRemoteExplorerContainerV2(input: {
  containerId: string;
  parentContainerId: string;
  runtime: ExplorerRuntime;
}): Promise<{
  accessManifestHash: string;
  containerId: string;
  metadataDocumentId: string;
  organizationId: string;
  parentId: string | null;
  persistedMetadataState: Pick<
    DocumentRecord,
    | "documentId"
    | "v2ContentKeyBundle"
    | "v2DocumentKekTargets"
    | "v2DocumentManifestBundle"
  >;
} | null> {
  const author = resolveExplorerV2Author(input.runtime);
  const apiClient = resolveExplorerV2CreateApi(input.runtime);
  const parentSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !apiClient || !parentSecretKey) {
    input.runtime.log(
      "Explorer: skipped V2 container create because the V2 writer context is unavailable.",
    );
    return null;
  }

  const createdContainer = await createRemoteContainerV2({
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    metadataDocumentId: input.containerId,
    parentContainerId: input.parentContainerId,
    parentSecretKey,
  });
  if (!createdContainer) {
    return null;
  }

  const createdMetadataDocument = await createRemoteDocumentV2({
    apiClient,
    author,
    containerId: createdContainer.containerId,
    documentId: createdContainer.metadataDocumentId,
    execSql: input.runtime.execSql,
    targetSecretKey: parentSecretKey,
  });
  if (!createdMetadataDocument) {
    return null;
  }

  return {
    accessManifestHash: createdContainer.response.manifestHead.manifestHash,
    containerId: createdContainer.containerId,
    metadataDocumentId: createdMetadataDocument.documentId,
    organizationId: createdContainer.response.organizationId,
    parentId: createdContainer.response.parentId,
    persistedMetadataState: createdMetadataDocument.persistedState,
  };
}

function readMutationMetadataDocumentId(input: {
  response: {
    accessManifest: { state: Record<string, unknown> };
  };
}): string {
  const metadataDocumentId = Reflect.get(
    input.response.accessManifest.state,
    "metadataDocumentId",
  );
  if (
    typeof metadataDocumentId !== "string" ||
    metadataDocumentId.length === 0
  ) {
    throw new Error("Container V2 mutation response is missing metadata state");
  }

  return metadataDocumentId;
}

function referencedPrincipalHeadsFromV2Response(input: {
  response: { referencedPrincipalHeads: readonly Record<string, unknown>[] };
}): ReferencedPrincipalStateResponse[] {
  return input.response.referencedPrincipalHeads.flatMap((head) => {
    const principalType = Reflect.get(head, "principalType");
    const principalId = Reflect.get(head, "principalId");
    const version = Reflect.get(head, "version");
    const keyEpoch = Reflect.get(head, "keyEpoch");
    const stateHash = Reflect.get(head, "stateHash");

    if (
      (principalType !== "group" && principalType !== "organization") ||
      typeof principalId !== "string" ||
      !Number.isInteger(version) ||
      !Number.isInteger(keyEpoch) ||
      typeof stateHash !== "string"
    ) {
      return [];
    }

    return [
      {
        principalType,
        principalId,
        version: version as number,
        keyEpoch: keyEpoch as number,
        stateHash,
      },
    ];
  });
}

export async function shareRemoteExplorerContainerV2(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  recipientUserId: string;
  runtime: ExplorerRuntime;
}): Promise<{
  accessManifestHash: string;
  accessEpoch: number;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReturnType<
    typeof referencedPrincipalHeadsFromV2Response
  >;
} | null> {
  const author = resolveExplorerV2Author(input.runtime);
  const apiClient = resolveExplorerV2ShareApi(input.runtime);
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !apiClient || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped V2 container share because the V2 writer context is unavailable.",
    );
    return null;
  }

  const recipientKey = await input.runtime.apiClient.getEncapsulationKey(
    input.recipientUserId,
  );
  if (!recipientKey) {
    return null;
  }

  const shared = await shareRemoteContainerV2({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    recipientEncapsulationPublicKey: base64ToBytes(
      recipientKey.encapsulationPublicKey,
    ),
    recipientUserId: input.recipientUserId,
    targetSecretKey,
  });
  if (!shared) {
    return null;
  }

  return {
    accessManifestHash: shared.response.manifestHead.manifestHash,
    accessEpoch: shared.response.manifestHead.epoch,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: shared.response,
    }),
    referencedPrincipalHeads: referencedPrincipalHeadsFromV2Response({
      response: shared.response,
    }),
  };
}

export async function moveRemoteExplorerContainerV2(input: {
  containerId: string;
  parentContainerId: string;
  runtime: ExplorerRuntime;
}): Promise<ExplorerRemoteContainer | null> {
  const author = resolveExplorerV2Author(input.runtime);
  const apiClient = resolveExplorerV2MoveApi(input.runtime);
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !apiClient || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped V2 container move because the V2 writer context is unavailable.",
    );
    return null;
  }

  const moved = await moveRemoteContainerV2({
    apiClient,
    author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    execSql: input.runtime.execSql,
    targetSecretKey,
  });
  if (!moved) {
    return null;
  }

  return {
    id: moved.response.containerId,
    organizationId: moved.response.organizationId,
    parentId: moved.response.parentId,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: moved.response,
    }),
    metadataAccessEpoch: moved.response.manifestHead.epoch,
    metadataAccessStateHash: moved.response.manifestHead.manifestHash,
    metadataRecipientEncapsulationPublicKeys: [],
    metadataReferencedPrincipals: referencedPrincipalHeadsFromV2Response({
      response: moved.response,
    }),
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
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      (error.message === "Document V2 content key could not be unwrapped" ||
        error.message === "Document V2 sync target hash mismatch" ||
        error.message === "Document V2 sync content-key targets mismatch")
    ) {
      state.runtime.log(
        `Explorer: deferred metadata sync for ${containerState.container.id} because its V2 content-key targets are stale.`,
      );
      return null;
    }

    throw error;
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
    Awaited<ReturnType<typeof createRemoteExplorerContainerV2>>
  >;
  host: ExplorerSyncHost;
  state: ExplorerSyncState;
  containerState: ContainerState;
}) {
  const { containerState, created, host, state } = input;

  const nextRecord = await host.persistContainerState(
    containerState,
    {
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      documentRecipientEnvelopes: null,
      lastCommitLsn: null,
      metadataDocumentId: created.metadataDocumentId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      ...created.persistedMetadataState,
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

  await state.persistence.markCreateIntentSynced(state.runtime.execSql, {
    containerId: containerState.container.id,
    remoteContainerId: created.containerId,
    remoteMetadataAccessStateHash: created.accessManifestHash,
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
  const created = await createRemoteExplorerContainerV2({
    containerId: containerState.container.id,
    parentContainerId: parentState.container.id,
    runtime: state.runtime,
  });

  if (!created) {
    await state.persistence.recordCreateIntentError(
      state.runtime.execSql,
      intent.containerId,
      "Remote V2 container create was rejected or unavailable",
    );
    return "failed";
  }

  await persistCreatedContainerFromIntent({
    containerState,
    created,
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
