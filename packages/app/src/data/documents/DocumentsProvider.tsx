import { bytesToHex, encryptForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  encryptLoroUpdate,
  exportAllUpdates,
  exportUpdatesSince,
  getTextValue,
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
import { useAppData } from "../AppDataProvider";
import {
  decryptBlobEnvelope,
  rewrapBlobRecipientEnvelopes,
  serializeBlobEnvelope,
} from "../blobEnvelope";
import type { BlobBytes, BlobStore } from "../blobs";
import { getScopedPeerSeed } from "../crdtPeerSeed";
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
} from "../documentSync";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../sync/syncCoordinator";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "./documentContent";
import {
  DOCUMENTS_APP_KIND,
  type StoredDocumentRecord as DocumentRecord,
  type DocumentSummary,
  type DocumentsPersistence,
  deriveDocumentKind,
  deriveDocumentTitle,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingAttachmentReplacementRecord,
  type PendingAttachmentRewrapRecord,
  type PendingUpdateRecord,
  type RelinkPersistedDocumentInput,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

type DocumentState = Awaited<ReturnType<typeof createDocument>>;
type DocumentAppData = ReturnType<typeof useAppData>;
type EncapsulationKeyPair = NonNullable<
  DocumentsRuntime["encapsulationKeyPair"]
>;
type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["apiClient"]["listDocumentAttachments"]>>
>[number];
type DocumentEncryptionMaterial = Awaited<
  ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
>;
type DocumentRecipientEnvelopes = ReturnType<
  typeof parseDocumentRecipientEnvelopes
>;
type CommitDocumentChangeResponse = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["apiClient"]["commitDocumentChange"]>>
>;
type AttachmentCommitChange = {
  expectedBindingId: string | null;
  slotId: string;
  stageId: string;
};
type AttachmentRewrapChange = {
  expectedBindingId: string;
  recipientEnvelopes: Awaited<ReturnType<typeof rewrapBlobRecipientEnvelopes>>;
  slotId: string;
};
type PendingMutationSyncResult = {
  completed: boolean;
  nextRecord: DocumentRecord;
};
interface PersistedDocumentRecord {
  record: DocumentRecord;
  updatedAt: string;
}
interface DocumentSyncAttempt {
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  encryptionMaterial: DocumentEncryptionMaterial | null;
  outgoingUpdateCount: number;
  synced: NonNullable<
    Awaited<ReturnType<DocumentsRuntime["apiClient"]["syncDocument"]>>
  >;
}
const DEFAULT_LOCAL_DOCUMENT_ID = "default";
export const DEFAULT_DOCUMENT_ID = DEFAULT_LOCAL_DOCUMENT_ID;

function sameAttachmentStorageKeys(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([slotId, storageKey]) => right[slotId] === storageKey)
  );
}

function sameAttachmentStatuses(
  left: Readonly<Record<string, DocumentAttachmentStatus>>,
  right: Readonly<Record<string, DocumentAttachmentStatus>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([slotId, status]) => right[slotId] === status)
  );
}

export interface DocumentsRuntime {
  apiClient: Pick<
    DocumentAppData["apiClient"],
    | "commitDocumentChange"
    | "createDocument"
    | "getBlob"
    | "listContainers"
    | "listDocumentAttachments"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: DocumentAppData["cacheReferencedPrincipalPolicies"];
  containerId: DocumentAppData["containerId"];
  dbStatus: DocumentAppData["dbStatus"];
  domainScope: DocumentAppData["domainScope"];
  encapsulationKeyPair: DocumentAppData["encapsulationKeyPair"];
  events: DocumentAppData["events"];
  execSql: DocumentAppData["execSql"];
  isAuthenticated: DocumentAppData["isAuthenticated"];
  log: DocumentAppData["log"];
  online: DocumentAppData["online"];
}

function createDocumentsRuntimeApiClient(
  apiClient: DocumentAppData["apiClient"],
): DocumentsRuntime["apiClient"] {
  return {
    commitDocumentChange: apiClient.commitDocumentChange.bind(apiClient),
    createDocument: apiClient.createDocument.bind(apiClient),
    getBlob: apiClient.getBlob.bind(apiClient),
    listContainers: apiClient.listContainers.bind(apiClient),
    listDocumentAttachments: apiClient.listDocumentAttachments.bind(apiClient),
    stageBlob: apiClient.stageBlob.bind(apiClient),
    syncDocument: apiClient.syncDocument.bind(apiClient),
  };
}

interface DocumentAttachmentUpload {
  bytes: BlobBytes;
  name: string;
  mimeType: string | null;
}

export type DocumentAttachmentStatus = "needs_replacement" | "syncing";

export interface DocumentContextValue {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface DocumentSnapshot {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
}

interface DocumentStore {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => DocumentSnapshot;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  requestSync: () => void;
  relink: (
    input: RelinkPersistedDocumentInput,
  ) => Promise<DocumentSummary | null>;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: DocumentsRuntime) => void;
}

interface DocumentStoreFacade extends DocumentStore {
  rebindTo: (store: DocumentStore) => void;
}

type PersistedDocumentListener = (document: DocumentSummary) => void;

interface DocumentStoreRegistry {
  storeKeysByDocumentId: Map<string, string>;
  storeKeysByLocalId: Map<string, string>;
  storesByKey: Map<string, DocumentStoreFacade>;
}

const documentStoreRegistriesByScope = new WeakMap<
  object,
  DocumentStoreRegistry
>();
const persistedDocumentListenersByScope = new WeakMap<
  object,
  Set<PersistedDocumentListener>
>();
const DocumentContext = createContext<DocumentStore | null>(null);

function getOrCreateDocumentStoreRegistry(
  domainScope: object,
): DocumentStoreRegistry {
  const existingRegistry = documentStoreRegistriesByScope.get(domainScope);
  if (existingRegistry) {
    return existingRegistry;
  }

  const nextRegistry: DocumentStoreRegistry = {
    storeKeysByDocumentId: new Map(),
    storeKeysByLocalId: new Map(),
    storesByKey: new Map(),
  };
  documentStoreRegistriesByScope.set(domainScope, nextRegistry);
  return nextRegistry;
}

function resolveDocumentStoreKey(
  registry: DocumentStoreRegistry,
  localId: string,
  documentId: string | null,
): string {
  return (
    (documentId ? registry.storeKeysByDocumentId.get(documentId) : undefined) ??
    registry.storeKeysByLocalId.get(localId) ??
    localId
  );
}

function registerDocumentStore(
  domainScope: object,
  localId: string,
  store: DocumentStoreFacade,
  documentId: string | null,
) {
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const storeKey = resolveDocumentStoreKey(registry, localId, documentId);
  registry.storeKeysByLocalId.set(localId, storeKey);
  if (documentId) {
    registry.storeKeysByDocumentId.set(documentId, storeKey);
  }
  registry.storesByKey.set(storeKey, store);
}

function registerDocumentStoreIdentity(
  domainScope: object,
  localId: string,
  documentId: string | null,
) {
  if (!documentId) {
    return;
  }

  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const localStoreKey = registry.storeKeysByLocalId.get(localId) ?? localId;
  const documentStoreKey =
    registry.storeKeysByDocumentId.get(documentId) ?? documentId;

  registry.storeKeysByLocalId.set(localId, documentStoreKey);
  registry.storeKeysByDocumentId.set(documentId, documentStoreKey);

  if (documentStoreKey === localStoreKey) {
    return;
  }

  const localStore = registry.storesByKey.get(localStoreKey);
  const documentStore = registry.storesByKey.get(documentStoreKey);
  if (localStore && documentStore) {
    documentStore.rebindTo(localStore);
    registry.storesByKey.set(documentStoreKey, localStore);
  } else if (localStore && !documentStore) {
    registry.storesByKey.set(documentStoreKey, localStore);
  }
  registry.storesByKey.delete(localStoreKey);
}

function requestDocumentStoreSync(state: DocumentStoreState) {
  state.syncLane?.requestSync();
}

function createDocumentStoreFacade(
  initialStore: DocumentStore,
): DocumentStoreFacade {
  let targetStore = initialStore;
  const listeners = new Set<() => void>();

  const emitFacade = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  let unsubscribeTarget = targetStore.subscribe(() => {
    emitFacade();
  });

  const connectTarget = (nextStore: DocumentStore) => {
    if (targetStore === nextStore) {
      return;
    }

    unsubscribeTarget();
    targetStore = nextStore;
    unsubscribeTarget = targetStore.subscribe(() => {
      emitFacade();
    });
    emitFacade();
  };

  return {
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      targetStore.attachFiles(files),
    ensureInitialized: () => targetStore.ensureInitialized(),
    getSnapshot: () => targetStore.getSnapshot(),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      targetStore.replaceAttachment(slotId, file),
    requestSync: () => targetStore.requestSync(),
    relink: (input) => targetStore.relink(input),
    rebindTo: (store) => connectTarget(store),
    setAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      targetStore.setAttachment(slotId, file),
    setText: (value: string) => targetStore.setText(value),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateRuntime: (runtime: DocumentsRuntime) =>
      targetStore.updateRuntime(runtime),
  };
}

function emitPersistedDocument(
  domainScope: object,
  persistedDocument: DocumentSummary,
): void {
  const listeners = persistedDocumentListenersByScope.get(domainScope);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(persistedDocument);
  }
}

export function subscribeToPersistedDocuments(
  domainScope: object,
  listener: PersistedDocumentListener,
): () => void {
  const listeners =
    persistedDocumentListenersByScope.get(domainScope) ??
    new Set<PersistedDocumentListener>();
  listeners.add(listener);
  persistedDocumentListenersByScope.set(domainScope, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      persistedDocumentListenersByScope.delete(domainScope);
    }
  };
}

interface DocumentStoreState {
  attachmentStorageKeyBySlotId: Record<string, string>;
  doc: DocumentState | null;
  initialDocumentId: string | null;
  initialText: string;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  localId: string;
  listeners: Set<() => void>;
  pendingAttachments: PendingAttachmentRecord[];
  pendingAttachmentReplacements: PendingAttachmentReplacementRecord[];
  pendingAttachmentRewraps: PendingAttachmentRewrapRecord[];
  persistence: DocumentsPersistence;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord | null;
  runtime: DocumentsRuntime;
  snapshot: DocumentSnapshot;
  syncLane: SyncLane | null;
  writeChain: Promise<void>;
}

function createDocumentStoreState(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence,
  initialDocumentId: string | null,
  initialText = "",
): DocumentStoreState {
  return {
    attachmentStorageKeyBySlotId: {},
    doc: null,
    initialDocumentId,
    initialText,
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    localId,
    listeners: new Set(),
    pendingAttachments: [],
    pendingAttachmentReplacements: [],
    pendingAttachmentRewraps: [],
    persistence,
    recipientPublicKeys: getLocalRecipientPublicKeys(
      initialRuntime.encapsulationKeyPair,
    ),
    record: null,
    runtime: initialRuntime,
    snapshot: {
      attachments: [],
      attachmentStatusBySlotId: {},
      attachmentStorageKeyBySlotId: {},
      canAttach: false,
      documentId: null,
      ready: false,
      text: "",
      syncing: false,
    },
    syncLane: null,
    writeChain: Promise.resolve(),
  };
}

function emitDocumentStore(state: DocumentStoreState) {
  for (const listener of state.listeners) {
    listener();
  }
}

function setDocumentSnapshot(
  state: DocumentStoreState,
  next: DocumentSnapshot,
) {
  if (
    sameDocumentAttachments(state.snapshot.attachments, next.attachments) &&
    sameAttachmentStatuses(
      state.snapshot.attachmentStatusBySlotId,
      next.attachmentStatusBySlotId,
    ) &&
    sameAttachmentStorageKeys(
      state.snapshot.attachmentStorageKeyBySlotId,
      next.attachmentStorageKeyBySlotId,
    ) &&
    state.snapshot.canAttach === next.canAttach &&
    state.snapshot.documentId === next.documentId &&
    state.snapshot.ready === next.ready &&
    state.snapshot.text === next.text &&
    state.snapshot.syncing === next.syncing
  ) {
    return;
  }

  state.snapshot = next;
  emitDocumentStore(state);
}

function updateDocumentRecipientPublicKeys(
  state: DocumentStoreState,
  encodedPublicKeys: string[],
) {
  state.recipientPublicKeys = resolveRecipientPublicKeys(encodedPublicKeys);
}

function resetDocumentStore(state: DocumentStoreState) {
  state.doc = null;
  state.record = null;
  state.pendingAttachments = [];
  state.pendingAttachmentReplacements = [];
  state.pendingAttachmentRewraps = [];
  state.attachmentStorageKeyBySlotId = {};
  state.initialized = false;
  state.initializePromise = null;
  state.writeChain = Promise.resolve();
  state.recipientPublicKeys = getLocalRecipientPublicKeys(
    state.runtime.encapsulationKeyPair,
  );
  setDocumentSnapshot(state, {
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: false,
    text: "",
    syncing: false,
  });
}

function canAttachFiles(state: DocumentStoreState): boolean {
  return (
    state.runtime.dbStatus === "ready" && !!state.runtime.encapsulationKeyPair
  );
}

function getSnapshotAttachments(
  state: DocumentStoreState,
  currentDoc: DocumentState | null = state.doc,
): DocumentAttachment[] {
  return currentDoc ? getDocumentAttachments(currentDoc) : [];
}

function getAttachmentStorageKeys(
  state: DocumentStoreState,
  attachments: ReadonlyArray<DocumentAttachment>,
): Record<string, string> {
  const nextStorageKeys: Record<string, string> = {};

  for (const attachment of attachments) {
    const storageKey = state.attachmentStorageKeyBySlotId[attachment.slotId];
    if (storageKey) {
      nextStorageKeys[attachment.slotId] = storageKey;
    }
  }

  return nextStorageKeys;
}

function getAttachmentStatuses(
  state: DocumentStoreState,
  attachments: ReadonlyArray<DocumentAttachment>,
): Record<string, DocumentAttachmentStatus> {
  const pendingAttachmentSlotIds = new Set(
    state.pendingAttachments.map((attachment) => attachment.slotId),
  );
  const replacementSlotIds = new Set(
    state.pendingAttachmentReplacements.map((attachment) => attachment.slotId),
  );
  const nextStatuses: Record<string, DocumentAttachmentStatus> = {};

  for (const attachment of attachments) {
    if (pendingAttachmentSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "syncing";
      continue;
    }

    if (replacementSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "needs_replacement";
    }
  }

  return nextStatuses;
}

function setReadySnapshot(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  syncing: boolean,
  text = getTextValue(currentDoc),
) {
  const attachments = getSnapshotAttachments(state, currentDoc);

  setDocumentSnapshot(state, {
    attachments,
    attachmentStatusBySlotId: getAttachmentStatuses(state, attachments),
    attachmentStorageKeyBySlotId: getAttachmentStorageKeys(state, attachments),
    canAttach: canAttachFiles(state),
    documentId: state.record?.documentId ?? null,
    ready: true,
    text,
    syncing,
  });
}

async function createStoredDocument() {
  const createdDoc = await createDocument(
    getScopedPeerSeed(DOCUMENTS_APP_KIND),
  );
  ensureDocumentAttachmentStructure(createdDoc);
  return createdDoc;
}

async function createEncryptedBlobUpload(
  bytes: BlobBytes,
  recipientKeys: Uint8Array[],
): Promise<{
  byteLength: number;
  encryptedBytes: string;
  sha256: string;
}> {
  const encryptedEnvelope = await encryptForRecipients(bytes, recipientKeys);
  const encryptedBytes = serializeBlobEnvelope(encryptedEnvelope);
  const encodedEnvelope = new TextEncoder().encode(encryptedBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodedEnvelope),
  );

  return {
    byteLength: encodedEnvelope.byteLength,
    encryptedBytes,
    sha256: bytesToHex(digest),
  };
}

async function saveDocumentRecord(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
): Promise<PersistedDocumentRecord> {
  const updatedAt = await state.persistence.saveDocument(
    state.runtime.execSql,
    nextRecord,
  );
  state.record = nextRecord;
  const persistedDocument = {
    accessStateHash: nextRecord.accessStateHash ?? null,
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentKind: deriveDocumentKind(nextRecord.text),
    documentId: nextRecord.documentId,
    title: deriveDocumentTitle(nextRecord.text),
    updatedAt,
  };
  registerDocumentStoreIdentity(
    state.runtime.domainScope,
    nextRecord.id,
    nextRecord.documentId,
  );
  emitPersistedDocument(state.runtime.domainScope, persistedDocument);
  return {
    record: nextRecord,
    updatedAt,
  };
}

async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
): Promise<PersistedDocumentRecord> {
  const currentDocumentId = state.record?.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
    patch,
    "documentRecipientEnvelopes",
  );
  const hasLastCommitLsnPatch = Object.hasOwn(patch, "lastCommitLsn");
  const nextRecord: DocumentRecord = {
    id: state.record?.id ?? state.localId,
    containerId:
      patch.containerId ??
      state.record?.containerId ??
      state.runtime.containerId ??
      null,
    documentId: nextDocumentId,
    documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
      ? (patch.documentRecipientEnvelopes ?? null)
      : (state.record?.documentRecipientEnvelopes ?? null),
    text: patch.text ?? getTextValue(currentDoc),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
    accessEpoch: patch.accessEpoch ?? state.record?.accessEpoch ?? 1,
    accessStateHash:
      patch.accessStateHash ?? state.record?.accessStateHash ?? null,
    lastCommitLsn: hasLastCommitLsnPatch
      ? (patch.lastCommitLsn ?? null)
      : nextDocumentId !== currentDocumentId
        ? null
        : (state.record?.lastCommitLsn ?? null),
  };

  const persistedRecord = await saveDocumentRecord(state, nextRecord);
  setReadySnapshot(state, currentDoc, state.snapshot.syncing, nextRecord.text);
  return persistedRecord;
}

async function ensureRemoteDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord | null,
): Promise<DocumentRecord | null> {
  if (nextRecord?.documentId) {
    return nextRecord;
  }

  if (!state.runtime.containerId) {
    state.runtime.log(
      "Documents: cannot create a remote document without a container.",
    );
    return nextRecord;
  }

  const listedContainers = await state.runtime.apiClient.listContainers();
  if (!listedContainers) {
    state.runtime.log(
      "Documents: skipped remote create because container access state is unavailable.",
    );
    return nextRecord;
  }

  const expectedAccessStateHash = listedContainers.find(
    (container) => container.id === state.runtime.containerId,
  )?.metadataAccessStateHash;
  if (
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    state.runtime.log(
      "Documents: skipped remote create because the current container access state hash is unavailable.",
    );
    return nextRecord;
  }

  const created = await state.runtime.apiClient.createDocument(
    [state.runtime.containerId],
    {
      [state.runtime.containerId]: expectedAccessStateHash,
    },
  );
  if (!created) {
    return nextRecord;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    created.referencedPrincipals,
  );

  updateDocumentRecipientPublicKeys(
    state,
    created.recipientEncapsulationPublicKeys,
  );
  state.runtime.log(`Created document: ${created.id}`);

  return (
    await persistDocument(state, currentDoc, {
      documentId: created.id,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        created.documentRecipientEnvelopes,
      ),
      accessEpoch: created.currentAccessEpoch,
      accessStateHash: created.currentAccessStateHash,
    })
  ).record;
}

async function listPendingUpdates(
  state: DocumentStoreState,
): Promise<PendingUpdateRecord[]> {
  return state.persistence.listPendingUpdates(
    state.runtime.execSql,
    state.localId,
  );
}

async function listPendingAttachmentRecords(
  state: DocumentStoreState,
): Promise<PendingAttachmentRecord[]> {
  return state.persistence.listPendingAttachments(
    state.runtime.execSql,
    state.localId,
  );
}

async function listLocalAttachmentRecords(state: DocumentStoreState) {
  return state.persistence.listLocalAttachments(
    state.runtime.execSql,
    state.localId,
  );
}

async function enqueuePendingUpdate(
  state: DocumentStoreState,
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
    localId: state.localId,
    ...pendingUpdateFields,
  });
}

async function deletePendingUpdate(state: DocumentStoreState, id: string) {
  await state.persistence.deletePendingUpdate(state.runtime.execSql, id);
}

async function saveLocalAttachmentRecord(
  state: DocumentStoreState,
  attachment: LocalAttachmentRecord,
  currentDoc: DocumentState | null = state.doc,
) {
  await state.persistence.saveLocalAttachment(
    state.runtime.execSql,
    attachment,
  );
  state.attachmentStorageKeyBySlotId = {
    ...state.attachmentStorageKeyBySlotId,
    [attachment.slotId]: attachment.storageKey,
  };

  if (currentDoc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      currentDoc === state.doc ? state.snapshot.text : getTextValue(currentDoc),
    );
  }
}

function listAttachmentsMissingLocalBytes(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): DocumentAttachment[] {
  return getDocumentAttachments(currentDoc).filter(
    (attachment) => !state.attachmentStorageKeyBySlotId[attachment.slotId],
  );
}

async function hydrateMissingAttachmentBlob(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  attachment: DocumentAttachment,
  binding: DocumentAttachmentBinding,
  encapsulationKeyPair: EncapsulationKeyPair,
) {
  const blob = await state.runtime.apiClient.getBlob(binding.blobId);
  if (!blob) {
    return;
  }

  const blobDigest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(blob.encryptedBytes),
    ),
  );
  const blobSha256 = bytesToHex(blobDigest);
  if (blobSha256 !== blob.sha256) {
    state.runtime.log(
      `Documents: blob ${binding.blobId} sha256 mismatch during hydration.`,
    );
    return;
  }

  const decryptedBytes = await decryptBlobEnvelope(
    blob.encryptedBytes,
    encapsulationKeyPair.secretKey,
    state.runtime.execSql,
  );
  const storageKey = `blob-${binding.blobId}`;
  await state.runtime.blobStore.writeBytes(storageKey, decryptedBytes);
  await saveLocalAttachmentRecord(
    state,
    {
      blobId: binding.blobId,
      byteLength: attachment.byteLength,
      localId: state.localId,
      mimeType: attachment.mimeType,
      slotId: attachment.slotId,
      storageKey,
    },
    currentDoc,
  );
}

async function hydrateAttachmentBlobs(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord | null,
) {
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (
    !encapsulationKeyPair ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online ||
    !currentRecord?.documentId
  ) {
    return;
  }

  const attachmentsMissingLocalBytes = listAttachmentsMissingLocalBytes(
    state,
    currentDoc,
  );
  if (attachmentsMissingLocalBytes.length === 0) {
    return;
  }

  const attachmentBindings =
    await state.runtime.apiClient.listDocumentAttachments(
      currentRecord.documentId,
    );
  if (!attachmentBindings) {
    return;
  }

  const bindingBySlotId = new Map(
    attachmentBindings.map((binding) => [binding.slotId, binding]),
  );

  for (const attachment of attachmentsMissingLocalBytes) {
    const binding = bindingBySlotId.get(attachment.slotId);
    if (!binding) {
      continue;
    }

    await hydrateMissingAttachmentBlob(
      state,
      currentDoc,
      attachment,
      binding,
      encapsulationKeyPair,
    );
  }
}

function isAttachmentSyncAlreadyPending(
  state: DocumentStoreState,
  slotId: string,
): boolean {
  return (
    state.pendingAttachmentReplacements.some(
      (pendingAttachmentReplacement) =>
        pendingAttachmentReplacement.slotId === slotId,
    ) ||
    state.pendingAttachmentRewraps.some(
      (pendingAttachmentRewrap) => pendingAttachmentRewrap.slotId === slotId,
    ) ||
    state.pendingAttachments.some(
      (pendingAttachment) => pendingAttachment.slotId === slotId,
    )
  );
}

async function createPendingAttachmentRewrap(
  state: DocumentStoreState,
  slotId: string,
  blobId: string,
): Promise<PendingAttachmentRewrapRecord> {
  const pendingAttachmentRewrap: PendingAttachmentRewrapRecord = {
    blobId,
    localId: state.localId,
    slotId,
  };
  await state.persistence.savePendingAttachmentRewrap(
    state.runtime.execSql,
    pendingAttachmentRewrap,
  );
  return pendingAttachmentRewrap;
}

async function createPendingAttachmentReplacement(
  state: DocumentStoreState,
  slotId: string,
  blobId: string | null,
): Promise<PendingAttachmentReplacementRecord> {
  const pendingAttachmentReplacement: PendingAttachmentReplacementRecord = {
    blobId,
    localId: state.localId,
    slotId,
  };
  await state.persistence.savePendingAttachmentReplacement(
    state.runtime.execSql,
    pendingAttachmentReplacement,
  );
  return pendingAttachmentReplacement;
}

function mergePendingAttachmentRewraps(
  state: DocumentStoreState,
  nextPendingAttachmentRewraps: ReadonlyArray<PendingAttachmentRewrapRecord>,
) {
  const nextSlotIds = new Set(
    nextPendingAttachmentRewraps.map(
      (pendingAttachmentRewrap) => pendingAttachmentRewrap.slotId,
    ),
  );
  state.pendingAttachmentRewraps = [
    ...state.pendingAttachmentRewraps.filter(
      (existingAttachmentRewrap) =>
        !nextSlotIds.has(existingAttachmentRewrap.slotId),
    ),
    ...nextPendingAttachmentRewraps,
  ];
}

function mergePendingAttachmentReplacements(
  state: DocumentStoreState,
  nextPendingAttachmentReplacements: ReadonlyArray<PendingAttachmentReplacementRecord>,
) {
  const nextSlotIds = new Set(
    nextPendingAttachmentReplacements.map(
      (pendingAttachmentReplacement) => pendingAttachmentReplacement.slotId,
    ),
  );
  state.pendingAttachmentReplacements = [
    ...state.pendingAttachmentReplacements.filter(
      (existingAttachmentReplacement) =>
        !nextSlotIds.has(existingAttachmentReplacement.slotId),
    ),
    ...nextPendingAttachmentReplacements,
  ];
}

async function clearPendingAttachmentReplacementsForSlots(
  state: DocumentStoreState,
  slotIds: ReadonlyArray<string>,
) {
  if (slotIds.length === 0) {
    return;
  }

  const slotIdSet = new Set(slotIds);
  state.pendingAttachmentReplacements =
    state.pendingAttachmentReplacements.filter(
      (pendingAttachmentReplacement) =>
        !slotIdSet.has(pendingAttachmentReplacement.slotId),
    );

  for (const slotId of slotIdSet) {
    await state.persistence.deletePendingAttachmentReplacement(
      state.runtime.execSql,
      state.localId,
      slotId,
    );
  }
}

function upsertPendingAttachments(
  state: DocumentStoreState,
  nextPendingAttachments: ReadonlyArray<PendingAttachmentRecord>,
) {
  const nextSlotIds = new Set(
    nextPendingAttachments.map((pendingAttachment) => pendingAttachment.slotId),
  );
  state.pendingAttachments = [
    ...state.pendingAttachments.filter(
      (pendingAttachment) => !nextSlotIds.has(pendingAttachment.slotId),
    ),
    ...nextPendingAttachments,
  ];
}

async function queuePendingAttachmentUpload(
  state: DocumentStoreState,
  attachment: DocumentAttachment,
  storageKey: string,
): Promise<PendingAttachmentRecord> {
  const pendingAttachment: PendingAttachmentRecord = {
    byteLength: attachment.byteLength,
    localId: state.localId,
    mimeType: attachment.mimeType,
    name: attachment.name,
    slotId: attachment.slotId,
    storageKey,
  };
  await state.persistence.savePendingAttachment(
    state.runtime.execSql,
    pendingAttachment,
  );
  upsertPendingAttachments(state, [pendingAttachment]);
  await clearPendingAttachmentReplacementsForSlots(state, [attachment.slotId]);
  return pendingAttachment;
}

async function queueCommittedAttachmentsForRewrap(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): Promise<boolean> {
  const currentAttachments = getDocumentAttachments(currentDoc);
  if (currentAttachments.length === 0) {
    return false;
  }

  const localAttachments = await listLocalAttachmentRecords(state);
  const localAttachmentBySlotId = new Map(
    localAttachments.map((attachment) => [attachment.slotId, attachment]),
  );
  const nextPendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];

  for (const attachment of currentAttachments) {
    if (isAttachmentSyncAlreadyPending(state, attachment.slotId)) {
      continue;
    }

    const localAttachment = localAttachmentBySlotId.get(attachment.slotId);
    if (!localAttachment?.blobId) {
      continue;
    }

    nextPendingAttachmentRewraps.push(
      await createPendingAttachmentRewrap(
        state,
        attachment.slotId,
        localAttachment.blobId,
      ),
    );
  }

  if (nextPendingAttachmentRewraps.length === 0) {
    return false;
  }

  mergePendingAttachmentRewraps(state, nextPendingAttachmentRewraps);
  return true;
}

async function queueCommittedAttachmentsForReplacement(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  documentId: string | null,
): Promise<boolean> {
  const currentAttachments = getDocumentAttachments(currentDoc);
  if (currentAttachments.length === 0) {
    return false;
  }

  const [localAttachments, currentBindings] = await Promise.all([
    listLocalAttachmentRecords(state),
    documentId ? listCurrentDocumentBindings(state, documentId) : null,
  ]);
  const localAttachmentBySlotId = new Map(
    localAttachments.map((attachment) => [attachment.slotId, attachment]),
  );
  const currentBindingBySlotId = new Map(
    (currentBindings ?? []).map((binding) => [binding.slotId, binding]),
  );
  const nextPendingAttachmentReplacements: PendingAttachmentReplacementRecord[] =
    [];
  let queuedUpload = false;

  for (const attachment of currentAttachments) {
    if (isAttachmentSyncAlreadyPending(state, attachment.slotId)) {
      continue;
    }

    const localAttachment = localAttachmentBySlotId.get(attachment.slotId);
    const localBytes = localAttachment
      ? await state.runtime.blobStore.readBytes(localAttachment.storageKey)
      : null;
    if (localAttachment && localBytes) {
      await queuePendingAttachmentUpload(
        state,
        attachment,
        localAttachment.storageKey,
      );
      queuedUpload = true;
      continue;
    }

    const currentBinding = currentBindingBySlotId.get(attachment.slotId);
    nextPendingAttachmentReplacements.push(
      await createPendingAttachmentReplacement(
        state,
        attachment.slotId,
        localAttachment?.blobId ?? currentBinding?.blobId ?? null,
      ),
    );
  }

  if (nextPendingAttachmentReplacements.length > 0) {
    mergePendingAttachmentReplacements(
      state,
      nextPendingAttachmentReplacements,
    );
  }

  if (queuedUpload || nextPendingAttachmentReplacements.length > 0) {
    setReadySnapshot(state, currentDoc, state.snapshot.syncing);
    return true;
  }

  return false;
}

async function replacePendingUpdatesWithBaseline(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  sourceVersionVector?: string | null,
) {
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    state.localId,
  );
  await enqueuePendingUpdate(
    state,
    exportAllUpdates(currentDoc),
    sourceVersionVector,
  );
}

async function initializeDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  await state.persistence.ensureSchema(state.runtime.execSql);

  const nextDoc = await createStoredDocument();
  const [
    existing,
    loadedPendingAttachments,
    loadedPendingAttachmentReplacements,
    loadedPendingAttachmentRewraps,
    localAttachments,
  ] = await Promise.all([
    state.persistence.loadDocument(state.runtime.execSql, state.localId),
    listPendingAttachmentRecords(state),
    state.persistence.listPendingAttachmentReplacements(
      state.runtime.execSql,
      state.localId,
    ),
    state.persistence.listPendingAttachmentRewraps(
      state.runtime.execSql,
      state.localId,
    ),
    listLocalAttachmentRecords(state),
  ]);
  state.pendingAttachments = loadedPendingAttachments;
  state.pendingAttachmentReplacements = loadedPendingAttachmentReplacements;
  state.pendingAttachmentRewraps = loadedPendingAttachmentRewraps;
  state.attachmentStorageKeyBySlotId = Object.fromEntries(
    localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.storageKey,
    ]),
  );

  if (existing) {
    if (existing.loroSnapshot.length > 0) {
      importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
    }

    state.record = existing;
    setReadySnapshot(state, nextDoc, false);
  } else {
    if (state.initialText.length > 0) {
      nextDoc.getText("text").update(state.initialText);
    }

    const created: DocumentRecord = {
      id: state.localId,
      containerId: state.runtime.containerId ?? null,
      documentId: state.initialDocumentId,
      documentRecipientEnvelopes: null,
      text: state.initialText,
      loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
      accessEpoch: 1,
      accessStateHash: null,
      lastCommitLsn: null,
    };
    await saveDocumentRecord(state, created);
    if (state.initialText.length > 0) {
      await enqueuePendingUpdate(state, exportAllUpdates(nextDoc));
    }
    setReadySnapshot(state, nextDoc, false, state.initialText);
  }

  state.doc = nextDoc;
  state.initialized = true;
  state.initializePromise = null;
  scheduleSync();
}

function ensureDocumentStoreInitialized(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeDocumentStore(state, scheduleSync).catch(
    (error: unknown) => {
      state.initializePromise = null;

      if (isDestroyedDatabaseClientError(error)) {
        return;
      }

      throw error;
    },
  );
}

function setDocumentSyncing(state: DocumentStoreState, syncing: boolean) {
  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    documentId: state.snapshot.documentId,
    ready: state.snapshot.ready,
    text: state.snapshot.text,
    syncing,
  });
}

async function awaitInitializationForSync(state: DocumentStoreState) {
  if (!state.initializePromise) {
    return true;
  }

  try {
    await state.initializePromise;
    return true;
  } catch (error) {
    if (isDestroyedDatabaseClientError(error)) {
      return false;
    }

    throw error;
  }
}

async function ensureDocumentStoreReady(
  state: DocumentStoreState,
  scheduleSync: () => void,
): Promise<boolean> {
  ensureDocumentStoreInitialized(state, scheduleSync);

  if (state.initialized) {
    return true;
  }

  if (!state.initializePromise) {
    return false;
  }

  return awaitInitializationForSync(state);
}

async function relinkDocumentStore(
  state: DocumentStoreState,
  input: RelinkPersistedDocumentInput,
): Promise<DocumentSummary | null> {
  if (!state.doc) {
    return null;
  }

  const currentAccessEpoch = state.record?.accessEpoch ?? 1;
  const patch: Partial<DocumentRecord> = {
    accessEpoch: Math.max(currentAccessEpoch, input.accessEpoch),
    accessStateHash:
      input.accessStateHash === undefined
        ? (state.record?.accessStateHash ?? null)
        : input.accessStateHash,
    containerId: input.containerId,
    documentId: input.documentId,
  };

  if (input.accessEpoch > currentAccessEpoch) {
    patch.documentRecipientEnvelopes = null;
  }

  const { record: nextRecord, updatedAt } = await persistDocument(
    state,
    state.doc,
    patch,
  );
  return {
    accessStateHash: nextRecord.accessStateHash ?? null,
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentId: nextRecord.documentId,
    title: deriveDocumentTitle(nextRecord.text),
    updatedAt,
  };
}

function canRunScheduledSync(state: DocumentStoreState): boolean {
  return (
    state.doc !== null &&
    state.snapshot.ready &&
    state.runtime.online &&
    state.runtime.isAuthenticated &&
    state.runtime.encapsulationKeyPair !== null
  );
}

async function buildAttachmentCommits(
  state: DocumentStoreState,
  attachmentsToCommit: PendingAttachmentRecord[],
  currentBindings: ReadonlyArray<DocumentAttachmentBinding>,
): Promise<AttachmentCommitChange[] | null> {
  const currentBindingBySlotId = new Map(
    currentBindings.map((binding) => [binding.slotId, binding]),
  );
  const attachmentCommits: AttachmentCommitChange[] = [];

  for (const attachment of attachmentsToCommit) {
    const localBytes = await state.runtime.blobStore.readBytes(
      attachment.storageKey,
    );
    if (!localBytes) {
      state.runtime.log(
        `Documents: missing local blob bytes for attachment ${attachment.slotId}.`,
      );
      return null;
    }

    const stagedBlob = await createEncryptedBlobUpload(
      localBytes,
      state.recipientPublicKeys,
    );
    const stage = await state.runtime.apiClient.stageBlob(stagedBlob);

    if (!stage) {
      return null;
    }

    attachmentCommits.push({
      expectedBindingId:
        currentBindingBySlotId.get(attachment.slotId)?.bindingId ?? null,
      slotId: attachment.slotId,
      stageId: stage.stageId,
    });
  }

  return attachmentCommits;
}

async function buildAttachmentRewraps(
  state: DocumentStoreState,
  attachmentsToRewrap: PendingAttachmentRewrapRecord[],
  currentBindings: ReadonlyArray<DocumentAttachmentBinding>,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<AttachmentRewrapChange[] | null> {
  const currentBindingBySlotId = new Map(
    currentBindings.map((binding) => [binding.slotId, binding]),
  );
  const blobById = new Map<
    string,
    Awaited<ReturnType<DocumentsRuntime["apiClient"]["getBlob"]>>
  >();
  const attachmentRewraps: AttachmentRewrapChange[] = [];

  for (const attachment of attachmentsToRewrap) {
    const currentBinding = currentBindingBySlotId.get(attachment.slotId);
    if (!currentBinding || currentBinding.blobId !== attachment.blobId) {
      continue;
    }

    let blob = blobById.get(attachment.blobId);
    if (!blob) {
      blob = await state.runtime.apiClient.getBlob(attachment.blobId);
      if (!blob) {
        return null;
      }
      blobById.set(attachment.blobId, blob);
    }

    attachmentRewraps.push({
      expectedBindingId: currentBinding.bindingId,
      recipientEnvelopes: await rewrapBlobRecipientEnvelopes({
        encryptedBytes: blob.encryptedBytes,
        execSql: state.runtime.execSql,
        recipientPublicKeys: state.recipientPublicKeys,
        secretKey: encapsulationKeyPair.secretKey,
      }),
      slotId: attachment.slotId,
    });
  }

  return attachmentRewraps;
}

async function commitBaselineChange(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRemoteRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  attachmentCommits: AttachmentCommitChange[],
  attachmentRewraps: AttachmentRewrapChange[],
  sourceVersionVector: string | null,
): Promise<CommitDocumentChangeResponse | null> {
  if (!nextRemoteRecord.documentId) {
    return null;
  }
  if (!nextRemoteRecord.accessStateHash) {
    state.runtime.log(
      "Documents: skipped attachment commit because the current access state hash is unavailable.",
    );
    return null;
  }

  const baselineUpdate = exportAllUpdates(currentDoc);
  const baselineUpdateFields = createPendingUpdateFields(baselineUpdate);
  if (!baselineUpdateFields) {
    return null;
  }

  const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
    nextRemoteRecord.documentRecipientEnvelopes,
  );
  const { documentKey, documentRecipientEnvelopes } =
    await getOrCreateDocumentEncryptionMaterial({
      documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
      execSql: state.runtime.execSql,
      recipientPublicKeys: state.recipientPublicKeys,
      secretKey: encapsulationKeyPair.secretKey,
    });
  const encryptedBaseline = await encryptLoroUpdate(
    baselineUpdate,
    nextRemoteRecord.accessEpoch,
    documentKey,
  );

  return state.runtime.apiClient.commitDocumentChange(
    nextRemoteRecord.documentId,
    {
      accessEpoch: nextRemoteRecord.accessEpoch,
      expectedAccessStateHash: nextRemoteRecord.accessStateHash,
      attachmentCommits,
      attachmentDetaches: [],
      attachmentRewraps,
      documentRecipientEnvelopes,
      loroUpdate: {
        checkpointKind: sourceVersionVector
          ? "rotate_baseline"
          : "fresh_baseline",
        encryptedData: encryptedBaseline,
        id: crypto.randomUUID(),
        partialEndVersionVector: baselineUpdateFields.partialEndVersionVector,
        partialStartVersionVector:
          baselineUpdateFields.partialStartVersionVector,
        referencedSlotIds: getDocumentAttachments(currentDoc).map(
          (attachment) => attachment.slotId,
        ),
        sourceVersionVector:
          sourceVersionVector ?? encodeVersionVector(currentDoc),
      },
    },
  );
}

async function commitAttachmentRewrapChange(
  state: DocumentStoreState,
  nextRemoteRecord: DocumentRecord,
  attachmentRewraps: AttachmentRewrapChange[],
): Promise<CommitDocumentChangeResponse | null> {
  if (!nextRemoteRecord.documentId) {
    return null;
  }
  if (!nextRemoteRecord.accessStateHash) {
    state.runtime.log(
      "Documents: skipped attachment rewrap because the current access state hash is unavailable.",
    );
    return null;
  }

  return state.runtime.apiClient.commitDocumentChange(
    nextRemoteRecord.documentId,
    {
      accessEpoch: nextRemoteRecord.accessEpoch,
      expectedAccessStateHash: nextRemoteRecord.accessStateHash,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps,
      loroUpdate: null,
    },
  );
}

async function saveCommittedAttachmentRecords(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
  committedBindings: CommitDocumentChangeResponse["committedBindings"],
) {
  const localAttachmentBySlotId = new Map(
    attachmentsToCommit.map((attachment) => [attachment.slotId, attachment]),
  );

  for (const committedBinding of committedBindings) {
    const localAttachment = localAttachmentBySlotId.get(
      committedBinding.slotId,
    );
    if (!localAttachment) {
      continue;
    }

    await saveLocalAttachmentRecord(
      state,
      {
        blobId: committedBinding.blobId,
        byteLength: localAttachment.byteLength,
        localId: state.localId,
        mimeType: localAttachment.mimeType,
        slotId: localAttachment.slotId,
        storageKey: localAttachment.storageKey,
      },
      currentDoc,
    );
  }
}

function getCurrentSyncState(state: DocumentStoreState): {
  currentDoc: DocumentState;
  currentRecord: DocumentRecord;
} | null {
  if (
    !state.doc ||
    !state.record ||
    !state.runtime.online ||
    !state.runtime.isAuthenticated
  ) {
    return null;
  }

  return {
    currentDoc: state.doc,
    currentRecord: state.record,
  };
}

async function listCurrentDocumentBindings(
  state: DocumentStoreState,
  documentId: string,
): Promise<ReadonlyArray<DocumentAttachmentBinding> | null> {
  return state.runtime.apiClient.listDocumentAttachments(documentId);
}

async function runSerializedMutation(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  onError: string,
  task: () => Promise<PendingMutationSyncResult>,
): Promise<PendingMutationSyncResult> {
  let result: PendingMutationSyncResult = {
    completed: false,
    nextRecord,
  };

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      result = await task();
    })
    .catch((error: unknown) => {
      console.error(onError, error);
    });

  await state.writeChain;
  return result;
}

async function runPendingAttachmentSyncTask(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  const currentSyncState = getCurrentSyncState(state);
  if (!currentSyncState) {
    return { completed: false, nextRecord };
  }
  const { currentDoc, currentRecord } = currentSyncState;

  const nextRemoteRecord = await ensureRemoteDocument(
    state,
    currentDoc,
    currentRecord,
  );
  if (!nextRemoteRecord?.documentId) {
    return { completed: false, nextRecord };
  }

  const attachmentsToCommit = [...state.pendingAttachments];
  if (attachmentsToCommit.length === 0) {
    return { completed: false, nextRecord };
  }

  const currentBindings = await listCurrentDocumentBindings(
    state,
    nextRemoteRecord.documentId,
  );
  if (!currentBindings) {
    return { completed: false, nextRecord };
  }

  const attachmentCommits = await buildAttachmentCommits(
    state,
    attachmentsToCommit,
    currentBindings,
  );
  if (!attachmentCommits) {
    return { completed: false, nextRecord };
  }

  const rotateBaselineSourceVersionVector =
    (await listPendingUpdates(state)).find(
      (pendingUpdate) => pendingUpdate.sourceVersionVector,
    )?.sourceVersionVector ?? null;
  const committed = await commitBaselineChange(
    state,
    currentDoc,
    nextRemoteRecord,
    encapsulationKeyPair,
    attachmentCommits,
    [],
    rotateBaselineSourceVersionVector,
  );
  if (!committed) {
    return { completed: false, nextRecord };
  }

  return {
    completed: true,
    nextRecord: await finalizePendingAttachmentSync(
      state,
      currentDoc,
      nextRemoteRecord.documentId,
      attachmentsToCommit,
      committed,
    ),
  };
}

async function syncPendingAttachments(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0) {
    return { completed: false, nextRecord };
  }

  return runSerializedMutation(
    state,
    nextRecord,
    "Failed to sync document attachments:",
    () => runPendingAttachmentSyncTask(state, nextRecord, encapsulationKeyPair),
  );
}

async function clearSyncedPendingAttachments(
  state: DocumentStoreState,
  attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
) {
  const committedSlotIds = new Set(
    attachmentsToCommit.map((attachmentToCommit) => attachmentToCommit.slotId),
  );
  state.pendingAttachments = state.pendingAttachments.filter(
    (pendingAttachment) => !committedSlotIds.has(pendingAttachment.slotId),
  );
  await state.persistence.deletePendingAttachments(
    state.runtime.execSql,
    state.localId,
  );
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    state.localId,
  );
  await clearPendingAttachmentReplacementsForSlots(
    state,
    Array.from(committedSlotIds),
  );
}

async function persistCommittedDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  documentId: string,
  committed: CommitDocumentChangeResponse,
): Promise<DocumentRecord> {
  return (
    await persistDocument(state, currentDoc, {
      accessEpoch: committed.currentAccessEpoch,
      accessStateHash: committed.currentAccessStateHash,
      documentId,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        committed.documentRecipientEnvelopes,
      ),
    })
  ).record;
}

async function finalizePendingAttachmentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  documentId: string,
  attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
  committed: CommitDocumentChangeResponse,
): Promise<DocumentRecord> {
  await saveCommittedAttachmentRecords(
    state,
    currentDoc,
    attachmentsToCommit,
    committed.committedBindings,
  );
  await clearSyncedPendingAttachments(state, attachmentsToCommit);
  return persistCommittedDocumentRecord(
    state,
    currentDoc,
    documentId,
    committed,
  );
}

async function clearPendingAttachmentRewraps(state: DocumentStoreState) {
  state.pendingAttachmentRewraps = [];
  await state.persistence.deletePendingAttachmentRewraps(
    state.runtime.execSql,
    state.localId,
  );
}

async function clearSyncedPendingAttachmentRewraps(
  state: DocumentStoreState,
  attachmentsToRewrap: ReadonlyArray<PendingAttachmentRewrapRecord>,
) {
  const syncedSlotIds = new Set(
    attachmentsToRewrap.map((attachmentToRewrap) => attachmentToRewrap.slotId),
  );
  state.pendingAttachmentRewraps = state.pendingAttachmentRewraps.filter(
    (pendingAttachmentRewrap) =>
      !syncedSlotIds.has(pendingAttachmentRewrap.slotId),
  );
  await state.persistence.deletePendingAttachmentRewraps(
    state.runtime.execSql,
    state.localId,
  );
}

async function clearEmptyPendingAttachmentRewraps(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
): Promise<PendingMutationSyncResult> {
  await clearPendingAttachmentRewraps(state);
  return { completed: false, nextRecord };
}

async function finalizePendingAttachmentRewrapSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  documentId: string,
  attachmentsToRewrap: ReadonlyArray<PendingAttachmentRewrapRecord>,
  committed: CommitDocumentChangeResponse,
): Promise<DocumentRecord> {
  await clearSyncedPendingAttachmentRewraps(state, attachmentsToRewrap);
  return persistCommittedDocumentRecord(
    state,
    currentDoc,
    documentId,
    committed,
  );
}

async function runPendingAttachmentRewrapTask(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  const currentSyncState = getCurrentSyncState(state);
  if (!currentSyncState) {
    return { completed: false, nextRecord };
  }
  const { currentDoc, currentRecord } = currentSyncState;

  const nextRemoteRecord = await ensureRemoteDocument(
    state,
    currentDoc,
    currentRecord,
  );
  if (!nextRemoteRecord?.documentId) {
    return { completed: false, nextRecord };
  }

  const attachmentsToRewrap = [...state.pendingAttachmentRewraps];
  if (attachmentsToRewrap.length === 0) {
    return { completed: false, nextRecord };
  }

  const currentBindings = await listCurrentDocumentBindings(
    state,
    nextRemoteRecord.documentId,
  );
  if (!currentBindings) {
    return { completed: false, nextRecord };
  }

  const attachmentRewraps = await buildAttachmentRewraps(
    state,
    attachmentsToRewrap,
    currentBindings,
    encapsulationKeyPair,
  );
  if (!attachmentRewraps) {
    return { completed: false, nextRecord };
  }
  if (attachmentRewraps.length === 0) {
    return clearEmptyPendingAttachmentRewraps(state, nextRecord);
  }

  const committed = await commitAttachmentRewrapChange(
    state,
    nextRemoteRecord,
    attachmentRewraps,
  );
  if (!committed) {
    return { completed: false, nextRecord };
  }

  return {
    completed: true,
    nextRecord: await finalizePendingAttachmentRewrapSync(
      state,
      currentDoc,
      nextRemoteRecord.documentId,
      attachmentsToRewrap,
      committed,
    ),
  };
}

async function syncPendingAttachmentRewraps(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachmentRewraps.length === 0) {
    return { completed: false, nextRecord };
  }

  return runSerializedMutation(
    state,
    nextRecord,
    "Failed to rewrap document attachments:",
    () =>
      runPendingAttachmentRewrapTask(state, nextRecord, encapsulationKeyPair),
  );
}

async function ensureDocumentRecordForSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  pendingUpdates: PendingUpdateRecord[],
): Promise<DocumentRecord | null> {
  if (nextRecord.documentId || pendingUpdates.length === 0) {
    return nextRecord;
  }

  return ensureRemoteDocument(state, currentDoc, nextRecord);
}

async function requestDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  pendingUpdates: PendingUpdateRecord[],
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentSyncAttempt | null> {
  if (!currentRecord.documentId) {
    return null;
  }

  const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
    currentRecord.documentRecipientEnvelopes,
  );
  const encryptionMaterial =
    pendingUpdates.length > 0
      ? await getOrCreateDocumentEncryptionMaterial({
          documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
          execSql: state.runtime.execSql,
          recipientPublicKeys: state.recipientPublicKeys,
          secretKey: encapsulationKeyPair.secretKey,
        })
      : null;
  const outgoingUpdates = encryptionMaterial
    ? await encryptPendingUpdates(
        pendingUpdates,
        currentRecord.accessEpoch,
        encryptionMaterial.documentKey,
      )
    : [];
  let synced = await state.runtime.apiClient.syncDocument(
    currentRecord.documentId,
    currentRecord.accessEpoch,
    encodeVersionVector(currentDoc),
    outgoingUpdates,
    encryptionMaterial && currentDocumentRecipientEnvelopes === null
      ? encryptionMaterial.documentRecipientEnvelopes
      : undefined,
    currentRecord.lastCommitLsn ?? undefined,
    currentRecord.accessStateHash ?? undefined,
  );
  if (!synced) {
    return null;
  }

  synced = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: currentRecord.accessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId: currentRecord.documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    recipientPublicKeys: state.recipientPublicKeys,
    secretKey: encapsulationKeyPair.secretKey,
    syncDocument: state.runtime.apiClient.syncDocument.bind(
      state.runtime.apiClient,
    ),
    synced,
  });

  return {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdateCount: outgoingUpdates.length,
    synced,
  };
}

async function requestDocumentSyncProbe(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentSyncAttempt | null> {
  if (!currentRecord.documentId) {
    return null;
  }

  const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
    currentRecord.documentRecipientEnvelopes,
  );
  let synced = await state.runtime.apiClient.syncDocument(
    currentRecord.documentId,
    currentRecord.accessEpoch,
    encodeVersionVector(currentDoc),
    [],
    undefined,
    currentRecord.lastCommitLsn ?? undefined,
  );
  if (!synced) {
    return null;
  }

  synced = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: currentRecord.accessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId: currentRecord.documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    recipientPublicKeys: state.recipientPublicKeys,
    secretKey: encapsulationKeyPair.secretKey,
    syncDocument: state.runtime.apiClient.syncDocument.bind(
      state.runtime.apiClient,
    ),
    synced,
  });

  return {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial: null,
    outgoingUpdateCount: 0,
    synced,
  };
}

function resolveNextDocumentRecipientEnvelopes(
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
): DocumentRecipientEnvelopes {
  const { currentDocumentRecipientEnvelopes, encryptionMaterial, synced } =
    syncAttempt;

  return resolveSyncedDocumentRecipientEnvelopes({
    currentAccessEpoch: currentRecord.accessEpoch,
    currentDocumentRecipientEnvelopes,
    generatedDocumentRecipientEnvelopes:
      encryptionMaterial?.documentRecipientEnvelopes ?? null,
    synced,
  });
}

async function applyIncomingSyncedUpdates(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  synced: DocumentSyncAttempt["synced"],
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes,
  nextDocumentRecipientEnvelopes: DocumentRecipientEnvelopes,
  previousAccessEpoch: number,
  encapsulationKeyPair: EncapsulationKeyPair,
) {
  if (synced.updates.length === 0) {
    return;
  }

  const decryptionBatches = resolveIncomingUpdateDecryptionBatches({
    currentDocumentRecipientEnvelopes,
    nextDocumentRecipientEnvelopes,
    previousAccessEpoch,
    synced,
  });

  if (decryptionBatches.length === 0) {
    state.runtime.log(
      "Documents: skipped incoming updates because the current document key bundle is missing.",
    );
    return;
  }

  let importedUpdates = 0;
  for (const decryptionBatch of decryptionBatches) {
    const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
      documentRecipientEnvelopes: decryptionBatch.documentRecipientEnvelopes,
      execSql: state.runtime.execSql,
      recipientPublicKeys: state.recipientPublicKeys,
      secretKey: encapsulationKeyPair.secretKey,
    });
    const decrypted = await decryptIncomingUpdates(
      decryptionBatch.updates,
      decryptionBatch.accessEpoch,
      documentKey,
      (message) => state.runtime.log(`Documents: ${message}`),
    );
    if (decrypted.length === 0) {
      continue;
    }

    importUpdates(currentDoc, decrypted);
    importedUpdates += decrypted.length;
  }

  if (importedUpdates === 0) {
    return;
  }

  setReadySnapshot(state, currentDoc, true);
}

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;
  updateDocumentRecipientPublicKeys(
    state,
    synced.recipientEncapsulationPublicKeys,
  );

  for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
    await deletePendingUpdate(state, acceptedOutgoingUpdateId);
  }

  const previousAccessEpoch = currentRecord.accessEpoch;
  const nextDocumentRecipientEnvelopes = resolveNextDocumentRecipientEnvelopes(
    currentRecord,
    syncAttempt,
  );
  await applyIncomingSyncedUpdates(
    state,
    currentDoc,
    synced,
    syncAttempt.currentDocumentRecipientEnvelopes,
    nextDocumentRecipientEnvelopes,
    previousAccessEpoch,
    encapsulationKeyPair,
  );

  const { record: nextRecord } = await persistDocument(state, currentDoc, {
    documentId: currentRecord.documentId,
    accessEpoch: synced.currentAccessEpoch,
    accessStateHash: synced.currentAccessStateHash,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      nextDocumentRecipientEnvelopes,
    ),
    lastCommitLsn: synced.commitLsn ?? currentRecord.lastCommitLsn ?? null,
  });
  const rotatedAccessEpoch =
    synced.currentAccessEpoch !== previousAccessEpoch &&
    synced.documentRecipientEnvelopeAction === "rotate";

  if (synced.currentAccessEpoch !== previousAccessEpoch) {
    if (rotatedAccessEpoch) {
      await clearPendingAttachmentRewraps(state);
      await replacePendingUpdatesWithBaseline(
        state,
        currentDoc,
        synced.rotateBaselineSourceVersionVector,
      );
      await hydrateAttachmentBlobs(state, currentDoc, nextRecord);
      const queuedReplacement = await queueCommittedAttachmentsForReplacement(
        state,
        currentDoc,
        nextRecord.documentId,
      );
      if (queuedReplacement) {
        state.runtime.log(
          "Documents: document epoch rotated; committed attachments were queued for replacement.",
        );
      }
    } else {
      await queueCommittedAttachmentsForRewrap(state, currentDoc);
      if (
        requiresBaselineAfterDocumentEpochChange({
          previousAccessEpoch,
          resolvedDocumentRecipientEnvelopes: nextDocumentRecipientEnvelopes,
          synced,
        })
      ) {
        await replacePendingUpdatesWithBaseline(state, currentDoc);
      }
    }
    requestDocumentStoreSync(state);
  }

  if (
    synced.canonicalDocumentRecipientEnvelopesAdopted ||
    syncAttempt.outgoingUpdateCount > synced.acceptedOutgoingUpdateIds.length
  ) {
    requestDocumentStoreSync(state);
  }

  if (!rotatedAccessEpoch) {
    await hydrateAttachmentBlobs(state, currentDoc, nextRecord);
  }
  return nextRecord;
}

async function syncDocumentState(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord> {
  const pendingUpdates = await listPendingUpdates(state);
  const nextRemoteRecord = await ensureDocumentRecordForSync(
    state,
    currentDoc,
    nextRecord,
    pendingUpdates,
  );
  if (!nextRemoteRecord?.documentId) {
    return nextRecord;
  }

  const syncAttempt = await requestDocumentSync(
    state,
    currentDoc,
    nextRemoteRecord,
    pendingUpdates,
    encapsulationKeyPair,
  );
  if (!syncAttempt) {
    return nextRemoteRecord;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    syncAttempt.synced.referencedPrincipals,
  );

  return finalizeDocumentSync(
    state,
    currentDoc,
    nextRemoteRecord,
    syncAttempt,
    encapsulationKeyPair,
  );
}

async function refreshRemoteDocumentBeforePendingAttachmentMutation(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (
    (state.pendingAttachments.length === 0 &&
      state.pendingAttachmentRewraps.length === 0) ||
    !nextRecord.documentId
  ) {
    return { completed: false, nextRecord };
  }

  const syncAttempt = await requestDocumentSyncProbe(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
  if (!syncAttempt) {
    return { completed: false, nextRecord };
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    syncAttempt.synced.referencedPrincipals,
  );

  const refreshedRecord = await finalizeDocumentSync(
    state,
    currentDoc,
    nextRecord,
    syncAttempt,
    encapsulationKeyPair,
  );

  return {
    completed:
      refreshedRecord.accessEpoch !== nextRecord.accessEpoch ||
      syncAttempt.synced.canonicalDocumentRecipientEnvelopesAdopted,
    nextRecord: refreshedRecord,
  };
}

async function runDocumentSyncPass(state: DocumentStoreState) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  let nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
    return;
  }

  const refreshedResult =
    await refreshRemoteDocumentBeforePendingAttachmentMutation(
      state,
      currentDoc,
      nextRecord,
      encapsulationKeyPair,
    );
  nextRecord = refreshedResult.nextRecord;
  if (refreshedResult.completed) {
    requestDocumentStoreSync(state);
    return;
  }

  const attachmentResult = await syncPendingAttachments(
    state,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = attachmentResult.nextRecord;
  if (attachmentResult.completed) {
    requestDocumentStoreSync(state);
    return;
  }

  const rewrapResult = await syncPendingAttachmentRewraps(
    state,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = rewrapResult.nextRecord;
  if (rewrapResult.completed) {
    requestDocumentStoreSync(state);
    return;
  }

  if (state.pendingAttachmentReplacements.length > 0) {
    return;
  }

  await syncDocumentState(state, currentDoc, nextRecord, encapsulationKeyPair);
}

async function runScheduledSyncIteration(state: DocumentStoreState) {
  if (!(await awaitInitializationForSync(state))) {
    return false;
  }

  if (!canRunScheduledSync(state)) {
    return true;
  }

  try {
    await runDocumentSyncPass(state);
    return true;
  } catch (error) {
    if (isDestroyedDatabaseClientError(error)) {
      return false;
    }

    throw error;
  }
}

async function runScheduledSyncLoop(state: DocumentStoreState) {
  setDocumentSyncing(state, true);

  try {
    const shouldContinue = await runScheduledSyncIteration(state);
    if (!shouldContinue) {
      return;
    }
  } finally {
    setDocumentSyncing(state, false);
  }
}

function handleDocumentRemoteEvents(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (!state.record?.documentId) {
    state.lastEventCount = state.runtime.events.length;
    return;
  }

  const nextEvents = state.runtime.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.events.length;

  if (
    nextEvents.some(
      (event) =>
        isDocumentUpdateCreatedEvent(event) &&
        event.documentId === state.record?.documentId,
    )
  ) {
    scheduleSync();
  }
}

function buildPendingAttachments(
  localId: string,
  files: ReadonlyArray<DocumentAttachmentUpload>,
): {
  nextAttachments: DocumentAttachment[];
  nextPendingAttachments: PendingAttachmentRecord[];
} {
  const nextPendingAttachments: PendingAttachmentRecord[] = [];
  const nextAttachments: DocumentAttachment[] = [];

  for (const file of files) {
    const slotId = crypto.randomUUID();
    const storageKey = `${localId}-${slotId}`;
    nextPendingAttachments.push({
      byteLength: file.bytes.byteLength,
      localId,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
      storageKey,
    });
    nextAttachments.push({
      byteLength: file.bytes.byteLength,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
    });
  }

  return { nextAttachments, nextPendingAttachments };
}

async function persistPendingAttachments(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
  nextPendingAttachments: PendingAttachmentRecord[],
) {
  for (const [index, pendingAttachment] of nextPendingAttachments.entries()) {
    const sourceFile = files[index];
    if (!sourceFile) {
      continue;
    }

    await state.runtime.blobStore.writeBytes(
      pendingAttachment.storageKey,
      sourceFile.bytes,
    );
    await saveLocalAttachmentRecord(state, {
      blobId: null,
      byteLength: pendingAttachment.byteLength,
      localId: state.localId,
      mimeType: pendingAttachment.mimeType,
      slotId: pendingAttachment.slotId,
      storageKey: pendingAttachment.storageKey,
    });
    await state.persistence.savePendingAttachment(
      state.runtime.execSql,
      pendingAttachment,
    );
  }
}

function logAttachedFiles(state: DocumentStoreState, count: number) {
  state.runtime.log(
    state.runtime.online && state.runtime.isAuthenticated
      ? `Attached ${count} file${count === 1 ? "" : "s"} to document ${state.localId}.`
      : `Stored ${count} attachment${count === 1 ? "" : "s"} locally for document ${state.localId}.`,
  );
}

async function persistAttachedFiles(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.log("Documents: attachments require a local key package.");
    return;
  }

  const { nextAttachments, nextPendingAttachments } = buildPendingAttachments(
    state.localId,
    files,
  );
  const previousVersion = encodeVersionVector(currentDoc);
  addDocumentAttachments(currentDoc, nextAttachments);
  const attachmentUpdate = exportUpdatesSince(currentDoc, previousVersion);
  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }

  await persistPendingAttachments(state, files, nextPendingAttachments);

  upsertPendingAttachments(state, nextPendingAttachments);
  await persistDocument(state, currentDoc);
  logAttachedFiles(state, files.length);
  requestDocumentStoreSync(state);
}

async function persistSlotAttachmentFile(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.log(
      "Documents: slot attachments require a local key package.",
    );
    return;
  }

  const replacementAttachment: DocumentAttachment = {
    byteLength: file.bytes.byteLength,
    mimeType: file.mimeType,
    name: file.name,
    slotId,
  };
  const previousVersion = encodeVersionVector(currentDoc);
  addDocumentAttachments(currentDoc, [replacementAttachment]);
  const attachmentUpdate = exportUpdatesSince(currentDoc, previousVersion);
  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }

  const storageKey = `${state.localId}-${slotId}-${crypto.randomUUID()}`;
  await state.runtime.blobStore.writeBytes(storageKey, file.bytes);
  await saveLocalAttachmentRecord(state, {
    blobId: null,
    byteLength: replacementAttachment.byteLength,
    localId: state.localId,
    mimeType: replacementAttachment.mimeType,
    slotId,
    storageKey,
  });
  await queuePendingAttachmentUpload(state, replacementAttachment, storageKey);
  await persistDocument(state, currentDoc);
  state.runtime.log(`Queued attachment ${file.name} for slot ${slotId}.`);
  requestDocumentStoreSync(state);
}

function refreshAttachabilitySnapshot(state: DocumentStoreState) {
  if (!state.snapshot.ready) {
    return;
  }

  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: canAttachFiles(state),
    documentId: state.snapshot.documentId,
    ready: state.snapshot.ready,
    text: state.snapshot.text,
    syncing: state.snapshot.syncing,
  });
}

function attachFilesToDocumentStore(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  if (files.length === 0 || !state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistAttachedFiles(state, files))
    .catch((error: unknown) => {
      console.error("Failed to attach document files:", error);
    });
}

function replaceAttachmentInDocumentStore(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  if (!state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistSlotAttachmentFile(state, slotId, file))
    .catch((error: unknown) => {
      console.error("Failed to replace document attachment:", error);
    });
}

function setAttachmentInDocumentStore(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  replaceAttachmentInDocumentStore(state, slotId, file);
}

function setDocumentText(state: DocumentStoreState, value: string) {
  if (!state.doc) {
    return;
  }

  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    documentId: state.snapshot.documentId,
    ready: state.snapshot.ready,
    text: value,
    syncing: state.snapshot.syncing,
  });

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc) {
        return;
      }

      if (getTextValue(state.doc) === value) {
        return;
      }

      const previousTextVersion = encodeVersionVector(state.doc);
      state.doc.getText("text").update(value);
      const update = exportUpdatesSince(state.doc, previousTextVersion);

      await enqueuePendingUpdate(state, update);
      await persistDocument(state, state.doc, { text: value });
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist document changes:", error);
    });
}

function subscribeToDocumentStore(
  state: DocumentStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

function updateDocumentStoreRuntime(
  state: DocumentStoreState,
  nextRuntime: DocumentsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  state.runtime = nextRuntime;
  if (!state.record?.documentId) {
    state.recipientPublicKeys = getLocalRecipientPublicKeys(
      state.runtime.encapsulationKeyPair,
    );
  }

  if (nextRuntime.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetDocumentStore(state);
    }
    state.lastEventCount = nextRuntime.events.length;
    return;
  }

  refreshAttachabilitySnapshot(state);
  ensureDocumentStoreInitialized(state, scheduleSync);
  handleDocumentRemoteEvents(state, scheduleSync);

  if (
    state.snapshot.ready &&
    didRegainSyncPrerequisites(previousRuntime, state.runtime)
  ) {
    scheduleSync();
  }
}

function createBackingDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = sqlDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
): DocumentStore {
  const state = createDocumentStoreState(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
  );
  state.syncLane = getOrCreateDomainSyncCoordinator(
    initialRuntime.domainScope,
  ).registerLane(`documents:${localId}`, {
    onUnexpectedError: (error) => {
      console.error("Failed to sync documents:", error);
    },
    run: () => runScheduledSyncLoop(state),
    shouldIgnoreError: isDestroyedDatabaseClientError,
  });
  const scheduleSync = () => requestDocumentStoreSync(state);

  return {
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      attachFilesToDocumentStore(state, files),
    ensureInitialized: () => ensureDocumentStoreReady(state, scheduleSync),
    getSnapshot: () => state.snapshot,
    setAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      setAttachmentInDocumentStore(state, slotId, file),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      replaceAttachmentInDocumentStore(state, slotId, file),
    requestSync: () => scheduleSync(),
    relink: (input) => relinkDocumentStore(state, input),
    setText: (value: string) => setDocumentText(state, value),
    subscribe: (listener: () => void) =>
      subscribeToDocumentStore(state, listener),
    updateRuntime: (runtime: DocumentsRuntime) =>
      updateDocumentStoreRuntime(state, runtime, scheduleSync),
  };
}

function createRegisteredDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = sqlDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
): DocumentStoreFacade {
  return createDocumentStoreFacade(
    createBackingDocumentStore(
      localId,
      initialRuntime,
      persistence,
      initialDocumentId,
      initialText,
    ),
  );
}

export function createDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = sqlDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
): DocumentStore {
  return createRegisteredDocumentStore(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
  );
}

function getOrCreateDocumentStore(
  domainScope: object,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
): DocumentStore {
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const existingStore = registry.storesByKey.get(
    resolveDocumentStoreKey(registry, localId, initialDocumentId),
  );
  if (existingStore) {
    registerDocumentStore(
      domainScope,
      localId,
      existingStore,
      initialDocumentId,
    );
    return existingStore;
  }

  const nextStore = createRegisteredDocumentStore(
    localId,
    runtime,
    sqlDocumentsPersistence,
    initialDocumentId,
    initialText,
  );
  registerDocumentStore(domainScope, localId, nextStore, initialDocumentId);
  return nextStore;
}

export function primeDocumentStore(
  domainScope: object,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
): DocumentStore {
  const store = getOrCreateDocumentStore(
    domainScope,
    localId,
    runtime,
    initialDocumentId,
    initialText,
  );
  store.updateRuntime(runtime);
  return store;
}

export function requestDomainDocumentSync(domainScope: object): void {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return;
  }

  for (const store of new Set(registry.storesByKey.values())) {
    store.requestSync();
  }
}

interface DocumentsProviderProps extends PropsWithChildren {
  localId?: string;
  containerId?: string | null;
  documentId?: string | null;
  initialText?: string;
}

export function DocumentsProvider({
  children,
  localId = DEFAULT_DOCUMENT_ID,
  containerId,
  documentId = null,
  initialText = "",
}: DocumentsProviderProps) {
  const appData = useAppData();
  const runtime = useMemo<DocumentsRuntime>(
    () => ({
      apiClient: createDocumentsRuntimeApiClient(appData.apiClient),
      blobStore: appData.blobStore,
      cacheReferencedPrincipalPolicies:
        appData.cacheReferencedPrincipalPolicies,
      containerId:
        containerId === undefined ? appData.containerId : containerId,
      dbStatus: appData.dbStatus,
      domainScope: appData.domainScope,
      encapsulationKeyPair: appData.encapsulationKeyPair,
      events: appData.events,
      execSql: appData.execSql,
      isAuthenticated: appData.isAuthenticated,
      log: appData.log,
      online: appData.online,
    }),
    [appData, containerId],
  );
  const store = useMemo(
    () =>
      getOrCreateDocumentStore(
        runtime.domainScope,
        localId,
        runtime,
        documentId,
        initialText,
      ),
    [documentId, initialText, localId, runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEffect(() => {
    store.requestSync();
  }, [
    runtime.encapsulationKeyPair,
    runtime.isAuthenticated,
    runtime.online,
    store,
  ]);

  return (
    <DocumentContext.Provider value={store}>
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const store = useContext(DocumentContext);
  if (!store) {
    throw new Error("useDocument must be used within a DocumentsProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      attachments: snapshot.attachments,
      attachmentStatusBySlotId: snapshot.attachmentStatusBySlotId,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      attachFiles: store.attachFiles,
      canAttach: snapshot.canAttach,
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      setAttachment: store.setAttachment,
      replaceAttachment: store.replaceAttachment,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
