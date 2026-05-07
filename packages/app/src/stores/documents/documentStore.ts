import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  getTextValue,
  importUpdates,
} from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createPendingUpdateFields,
  isDocumentUpdateCreatedEvent,
} from "../../data/documentSync";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "../../data/documents/documentContent";
import type { DocumentSummary } from "../../data/documents/shared/documentSummary";
import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import {
  DOCUMENTS_APP_KIND,
  type StoredDocumentRecord as DocumentRecord,
  type DocumentsPersistence,
  deriveDocumentKind,
  deriveDocumentTitle,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import {
  hydrateDocumentAttachmentBlobs,
  uploadDocumentAttachment,
} from "../../workflows/blobs";
import {
  createDocumentWriterPublicKeyResolver,
  createRemoteDocument,
  type DocumentCreateAuthor,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../../workflows/documents";
import {
  createDocumentStoreFacade,
  emitPersistedDocument,
  getOrCreateDocumentStoreRegistry,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  requestDocumentStoreSync,
  resolveDocumentStoreKey,
} from "./registry";
import type {
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
  DocumentSnapshot,
  DocumentStore,
  DocumentStoreFacade,
  DocumentStoreRelinkInput,
  DocumentsRuntime,
} from "./types";

export {
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "./registry";

type DocumentState = Awaited<ReturnType<typeof createDocument>>;
type EncapsulationKeyPair = NonNullable<
  DocumentsRuntime["encapsulationKeyPair"]
>;
type DocumentAttachmentRuntimeApi = Pick<
  DocumentsRuntime["apiClient"],
  "bindBlobAttachment" | "getDocumentWriterProjection" | "stageBlob"
>;
type ResolvedDocumentAttachmentRuntimeApi = DocumentAttachmentRuntimeApi &
  Pick<DocumentsRuntime["apiClient"], "listDocumentAttachments">;
type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["apiClient"]["listDocumentAttachments"]>>
>[number];
type PendingMutationSyncResult = {
  completed: boolean;
  nextRecord: DocumentRecord;
};
interface PersistedDocumentRecord {
  record: DocumentRecord;
  updatedAt: string;
}
interface SaveDocumentRecordOptions {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
}
interface DocumentSyncAttempt {
  outgoingUpdateCount: number;
  synced: NonNullable<Awaited<ReturnType<typeof syncRemoteDocument>>>;
}

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
  persistence: DocumentsPersistence;
  record: DocumentRecord | null;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
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
    persistence,
    record: null,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      initialRuntime,
      "Documents",
    ),
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

function resetDocumentStore(state: DocumentStoreState) {
  state.doc = null;
  state.record = null;
  state.pendingAttachments = [];
  state.attachmentStorageKeyBySlotId = {};
  state.initialized = false;
  state.initializePromise = null;
  state.writeChain = Promise.resolve();
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
  const nextStatuses: Record<string, DocumentAttachmentStatus> = {};

  for (const attachment of attachments) {
    if (pendingAttachmentSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "syncing";
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

async function saveDocumentRecord(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const documentIdChanged =
    (state.record?.documentId ?? null) !== nextRecord.documentId;
  const acceptedPendingUpdateIds = options.acceptedPendingUpdateIds ?? [];
  const updatedAt =
    acceptedPendingUpdateIds.length > 0
      ? await state.persistence.saveDocumentAndDeletePendingUpdates(
          state.runtime.execSql,
          nextRecord,
          acceptedPendingUpdateIds,
        )
      : await state.persistence.saveDocument(state.runtime.execSql, nextRecord);
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
  if (documentIdChanged) {
    registerDocumentStoreIdentity(
      state.runtime.domainScope,
      nextRecord.id,
      nextRecord.documentId,
    );
  }
  emitPersistedDocument(state.runtime.domainScope, persistedDocument);
  return {
    record: nextRecord,
    updatedAt,
  };
}

type NullableDocumentRuntimeField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

function resolveNullableDocumentRuntimeField(
  patch: Partial<DocumentRecord>,
  key: NullableDocumentRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const currentDocumentId = state.record?.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const currentAccessEpoch =
    state.record?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const nextAccessEpoch = patch.accessEpoch ?? currentAccessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== currentAccessEpoch;
  const nextRecord: DocumentRecord = {
    id: state.record?.id ?? state.localId,
    containerId:
      patch.containerId ??
      state.record?.containerId ??
      state.runtime.containerId ??
      null,
    documentId: nextDocumentId,
    text: patch.text ?? getTextValue(currentDoc),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableDocumentRuntimeField(
      patch,
      "accessStateHash",
      state.record?.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableDocumentRuntimeField(
      patch,
      "lastCommitLsn",
      state.record?.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableDocumentRuntimeField(
      patch,
      "contentKeyBundle",
      state.record?.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableDocumentRuntimeField(
      patch,
      "documentKekTargets",
      state.record?.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableDocumentRuntimeField(
      patch,
      "documentManifestBundle",
      state.record?.documentManifestBundle,
      securityContextChanged,
    ),
  };

  const persistedRecord = await saveDocumentRecord(state, nextRecord, options);
  setReadySnapshot(state, currentDoc, state.snapshot.syncing, nextRecord.text);
  return persistedRecord;
}

async function ensureRemoteDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord | null,
  encapsulationKeyPair: EncapsulationKeyPair,
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

  const author = resolveDocumentCreateAuthor(state.runtime);
  const { apiClient } = state.runtime;
  if (!author) {
    state.runtime.log(
      "Documents: skipped remote create because the writer context is unavailable.",
    );
    return nextRecord;
  }

  const created = await createRemoteDocument({
    apiClient,
    author,
    containerId: state.runtime.containerId,
    execSql: state.runtime.execSql,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    return nextRecord;
  }

  state.runtime.log(`Created document: ${created.documentId}`);

  return (
    await persistDocument(state, currentDoc, {
      ...created.persistedState,
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

async function deletePendingAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  await state.persistence.deletePendingAttachment(
    state.runtime.execSql,
    state.localId,
    slotId,
    storageKey,
  );
}

async function saveLocalAttachmentRecord(
  state: DocumentStoreState,
  attachment: LocalAttachmentRecord,
  currentDoc: DocumentState | null = state.doc,
) {
  await saveLocalAttachmentRecords(state, [attachment], currentDoc);
}

async function saveLocalAttachmentRecords(
  state: DocumentStoreState,
  attachments: ReadonlyArray<LocalAttachmentRecord>,
  currentDoc: DocumentState | null = state.doc,
) {
  if (attachments.length === 0) {
    return;
  }

  for (const attachment of attachments) {
    await state.persistence.saveLocalAttachment(
      state.runtime.execSql,
      attachment,
    );
  }

  state.attachmentStorageKeyBySlotId = {
    ...state.attachmentStorageKeyBySlotId,
    ...Object.fromEntries(
      attachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    ),
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

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: state.runtime.apiClient,
    attachments: attachmentsMissingLocalBytes,
    documentId: currentRecord.documentId,
    execSql: state.runtime.execSql,
    log: state.runtime.log,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!hydratedBlobs) {
    return;
  }

  const localAttachmentRecords: LocalAttachmentRecord[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    await state.runtime.blobStore.writeBytes(
      hydratedBlob.storageKey,
      hydratedBlob.bytes,
    );
    localAttachmentRecords.push({
      blobId: hydratedBlob.binding.blobId,
      byteLength: hydratedBlob.attachment.byteLength,
      localId: state.localId,
      mimeType: hydratedBlob.attachment.mimeType,
      slotId: hydratedBlob.attachment.slotId,
      storageKey: hydratedBlob.storageKey,
    });
  }

  await saveLocalAttachmentRecords(state, localAttachmentRecords, currentDoc);
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
  return pendingAttachment;
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
  const [existing, loadedPendingAttachments, localAttachments] =
    await Promise.all([
      state.persistence.loadDocument(state.runtime.execSql, state.localId),
      listPendingAttachmentRecords(state),
      listLocalAttachmentRecords(state),
    ]);
  state.pendingAttachments = loadedPendingAttachments;
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
      text: state.initialText,
      loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
      accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
      accessStateHash: null,
      lastCommitLsn: null,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
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
  input: DocumentStoreRelinkInput,
): Promise<DocumentSummary | null> {
  if (!state.doc) {
    return null;
  }

  const currentAccessEpoch =
    state.record?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const patch: Partial<DocumentRecord> = {
    accessEpoch: Math.max(currentAccessEpoch, input.accessEpoch),
    accessStateHash:
      input.accessStateHash === undefined
        ? (state.record?.accessStateHash ?? null)
        : input.accessStateHash,
    containerId: input.containerId,
    documentId: input.documentId,
  };
  if (input.contentKeyBundle !== undefined) {
    patch.contentKeyBundle = input.contentKeyBundle;
  }
  if (input.documentKekTargets !== undefined) {
    patch.documentKekTargets = input.documentKekTargets;
  }
  if (input.documentManifestBundle !== undefined) {
    patch.documentManifestBundle = input.documentManifestBundle;
  }

  const { record: nextRecord, updatedAt } = await persistDocument(
    state,
    state.doc,
    patch,
  );
  if (input.queueBaselineAfterRelink) {
    await enqueuePendingUpdate(
      state,
      exportAllUpdates(state.doc),
      encodeVersionVector(state.doc),
    );
    requestDocumentStoreSync(state);
  }
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
    state.runtime.encapsulationKeyPair !== null &&
    resolveDocumentCreateAuthor(state.runtime) !== null
  );
}

async function syncPendingAttachments(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0) {
    return { completed: false, nextRecord };
  }

  const currentDoc = state.doc;
  if (!currentDoc) {
    return { completed: false, nextRecord };
  }

  const currentRecord = await ensureRemoteDocumentForAttachmentSync(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
  if (!currentRecord?.documentId) {
    return { completed: false, nextRecord };
  }
  const remoteDocumentId = currentRecord.documentId;

  const author = resolveDocumentCreateAuthor(state.runtime);
  const { apiClient } = state.runtime;
  if (!author) {
    state.runtime.log(
      "Documents: skipped attachment upload because the writer context is unavailable.",
    );
    return { completed: false, nextRecord: currentRecord };
  }

  const remoteBindings =
    await apiClient.listDocumentAttachments(remoteDocumentId);
  if (!remoteBindings) {
    return { completed: false, nextRecord: currentRecord };
  }

  const activeBindingBySlotId = new Map(
    remoteBindings.map((binding) => [binding.slotId, binding]),
  );
  const completedSlotIds = new Set<string>();

  for (const pendingAttachment of [...state.pendingAttachments]) {
    const uploaded = await syncPendingAttachmentUpload({
      activeBindingBySlotId,
      apiClient,
      author,
      encapsulationKeyPair,
      pendingAttachment,
      remoteDocumentId,
      state,
    });
    if (!uploaded) {
      return {
        completed: completedSlotIds.size > 0,
        nextRecord: currentRecord,
      };
    }

    completedSlotIds.add(pendingAttachment.slotId);
    state.pendingAttachments = state.pendingAttachments.filter(
      (attachment) => attachment !== pendingAttachment,
    );
  }

  if (completedSlotIds.size === 0) {
    return { completed: false, nextRecord: currentRecord };
  }

  setReadySnapshot(state, currentDoc, state.snapshot.syncing);

  return { completed: true, nextRecord: currentRecord };
}

async function ensureDocumentRecordForSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  pendingUpdates: PendingUpdateRecord[],
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord.documentId || pendingUpdates.length === 0) {
    return nextRecord;
  }

  return ensureRemoteDocument(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
}

async function ensureRemoteDocumentForAttachmentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord.documentId) {
    return nextRecord;
  }

  return ensureRemoteDocument(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
}

async function syncPendingAttachmentUpload(input: {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  apiClient: ResolvedDocumentAttachmentRuntimeApi;
  author: DocumentCreateAuthor;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { pendingAttachment, state } = input;
  const bytes = await state.runtime.blobStore.readBytes(
    pendingAttachment.storageKey,
  );
  if (!bytes) {
    state.runtime.log(
      `Documents: pending attachment ${pendingAttachment.slotId} is missing local bytes.`,
    );
    return false;
  }

  const uploaded = await uploadDocumentAttachment({
    apiClient: input.apiClient,
    author: input.author,
    bytes,
    documentId: input.remoteDocumentId,
    execSql: state.runtime.execSql,
    expectedBindingId:
      input.activeBindingBySlotId.get(pendingAttachment.slotId)?.bindingId ??
      null,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  if (!uploaded) {
    return false;
  }

  await saveLocalAttachmentRecord(state, {
    blobId: uploaded.blobId,
    byteLength: pendingAttachment.byteLength,
    localId: state.localId,
    mimeType: pendingAttachment.mimeType,
    slotId: pendingAttachment.slotId,
    storageKey: pendingAttachment.storageKey,
  });
  await deletePendingAttachment(
    state,
    pendingAttachment.slotId,
    pendingAttachment.storageKey,
  );
  input.activeBindingBySlotId.set(pendingAttachment.slotId, {
    bindingId: uploaded.bindingId,
    blobId: uploaded.blobId,
    slotId: pendingAttachment.slotId,
  });
  state.runtime.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
  return true;
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

  const author = resolveDocumentCreateAuthor(state.runtime);
  const { apiClient } = state.runtime;
  if (!author) {
    state.runtime.log(
      "Documents: skipped sync because the writer context is unavailable.",
    );
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient,
    author,
    documentId: currentRecord.documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    pendingUpdates,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime: state.runtime,
      writerKeyLabel: "writer key",
    }),
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

async function requestDocumentSyncProbe(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentSyncAttempt | null> {
  if (!currentRecord.documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  const { apiClient } = state.runtime;
  if (!author) {
    state.runtime.log(
      "Documents: skipped sync probe because the writer context is unavailable.",
    );
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient,
    author,
    documentId: currentRecord.documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    pendingUpdates: [],
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime: state.runtime,
      writerKeyLabel: "writer key",
    }),
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: 0,
    synced,
  };
}

async function applyIncomingSyncedUpdates(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  syncAttempt: DocumentSyncAttempt,
) {
  if (syncAttempt.synced.decryptedUpdates.length === 0) {
    return;
  }

  importUpdates(
    currentDoc,
    syncAttempt.synced.decryptedUpdates.map((update) => update.updateData),
  );

  setReadySnapshot(state, currentDoc, true);
}

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;

  await applyIncomingSyncedUpdates(state, currentDoc, syncAttempt);

  const { record: nextRecord } = await persistDocument(
    state,
    currentDoc,
    {
      ...synced.persistedState,
      lastCommitLsn:
        synced.response.commitLsn ?? currentRecord.lastCommitLsn ?? null,
    },
    {
      acceptedPendingUpdateIds: synced.response.acceptedOutgoingUpdateIds,
    },
  );

  if (
    syncAttempt.outgoingUpdateCount >
    synced.response.acceptedOutgoingUpdateIds.length
  ) {
    requestDocumentStoreSync(state);
  }

  await hydrateAttachmentBlobs(state, currentDoc, nextRecord);
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
    encapsulationKeyPair,
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

  return finalizeDocumentSync(state, currentDoc, nextRemoteRecord, syncAttempt);
}

async function refreshRemoteDocumentBeforePendingAttachmentMutation(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0 || !nextRecord.documentId) {
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

  const refreshedRecord = await finalizeDocumentSync(
    state,
    currentDoc,
    nextRecord,
    syncAttempt,
  );

  return {
    // A probe can advance commitLsn without delivering document changes. Keep
    // the current pass going so pending attachment uploads are not starved.
    completed: syncAttempt.synced.decryptedUpdates.length > 0,
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
  if (state.pendingAttachments.length > 0) {
    return;
  }
  if (attachmentResult.completed) {
    requestDocumentStoreSync(state);
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

function didDocumentProjectionResolverContextChange(
  previousRuntime: DocumentsRuntime,
  nextRuntime: DocumentsRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}

function updateDocumentStoreRuntime(
  state: DocumentStoreState,
  nextRuntime: DocumentsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  const domainScopeChanged =
    previousRuntime.domainScope !== nextRuntime.domainScope;
  if (
    didDocumentProjectionResolverContextChange(previousRuntime, nextRuntime)
  ) {
    state.resolveProjectionUserKey = createProjectionUserKeyResolver(
      nextRuntime,
      "Documents",
    );
  }
  state.runtime = nextRuntime;
  if (domainScopeChanged) {
    state.syncLane = registerDocumentSyncLane(state);
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

function registerDocumentSyncLane(state: DocumentStoreState): SyncLane {
  return getOrCreateDomainSyncCoordinator(
    state.runtime.domainScope,
  ).registerLane(`documents:${state.localId}`, {
    onUnexpectedError: (error) => {
      console.error("Failed to sync documents:", error);
    },
    run: () => runScheduledSyncLoop(state),
    shouldIgnoreError: isDestroyedDatabaseClientError,
  });
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
  state.syncLane = registerDocumentSyncLane(state);
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

export function getOrCreateDocumentStore(
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
