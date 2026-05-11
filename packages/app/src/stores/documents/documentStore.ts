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
import type { DocumentSummary } from "../../data/documentSummary";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "../../data/documents/documentContent";
import {
  type CreditCardDocumentFields,
  type DriverLicenseDocumentFields,
  initializeStoredDocumentKind,
  projectStoredDocumentState,
  readStoredDocumentState,
  type StoredDocumentKind,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import {
  DOCUMENTS_APP_KIND,
  type DocumentProjectionUserKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  hasDocumentUpdateEvent,
  isDestroyedDocumentSyncRuntimeError,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
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
type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["listDocumentAttachments"]>>
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
type DocumentSyncAttempt = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["syncRemoteDocument"]>>
>;

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

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function sameValidationIssues(
  left: DocumentSnapshot["fieldValidationIssues"],
  right: DocumentSnapshot["fieldValidationIssues"],
): boolean {
  return (
    left.length === right.length &&
    left.every((issue, index) => {
      const nextIssue = right[index];
      return (
        nextIssue !== undefined &&
        issue.field === nextIssue.field &&
        issue.message === nextIssue.message &&
        Object.is(issue.value, nextIssue.value)
      );
    })
  );
}

interface DocumentStoreState {
  attachmentStorageKeyBySlotId: Record<string, string>;
  doc: DocumentState | null;
  initialDocumentId: string | null;
  initialDocumentKind: StoredDocumentKind;
  initialText: string;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  localId: string;
  listeners: Set<() => void>;
  pendingAttachments: PendingAttachmentRecord[];
  persistence: DocumentsPersistence;
  record: DocumentRecord | null;
  resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
  runtime: DocumentsRuntime;
  snapshot: DocumentSnapshot;
  syncLane: DocumentSyncLane | null;
  writeChain: Promise<void>;
}

function createDocumentStoreState(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence,
  initialDocumentId: string | null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStoreState {
  return {
    attachmentStorageKeyBySlotId: {},
    doc: null,
    initialDocumentId,
    initialDocumentKind,
    initialText,
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    localId,
    listeners: new Set(),
    pendingAttachments: [],
    persistence,
    record: null,
    resolveProjectionUserKey: initialRuntime.createProjectionUserKeyResolver(),
    runtime: initialRuntime,
    snapshot: {
      attachments: [],
      attachmentStatusBySlotId: {},
      attachmentStorageKeyBySlotId: {},
      canAttach: false,
      documentId: null,
      documentKind: "note",
      fieldValidationIssues: [],
      ready: false,
      structuredFields: {},
      text: "",
      title: "",
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
    state.snapshot.documentKind === next.documentKind &&
    sameValidationIssues(
      state.snapshot.fieldValidationIssues,
      next.fieldValidationIssues,
    ) &&
    state.snapshot.ready === next.ready &&
    sameStringRecord(state.snapshot.structuredFields, next.structuredFields) &&
    state.snapshot.text === next.text &&
    state.snapshot.title === next.title &&
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
    documentKind: "note",
    fieldValidationIssues: [],
    ready: false,
    structuredFields: {},
    text: "",
    title: "",
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
  textOverride?: string,
) {
  const attachments = getSnapshotAttachments(state, currentDoc);
  const documentState = readStoredDocumentState(currentDoc);
  const text = textOverride ?? documentState.text;

  setDocumentSnapshot(state, {
    attachments,
    attachmentStatusBySlotId: getAttachmentStatuses(state, attachments),
    attachmentStorageKeyBySlotId: getAttachmentStorageKeys(state, attachments),
    canAttach: canAttachFiles(state),
    documentId: state.record?.documentId ?? null,
    documentKind: documentState.documentKind,
    fieldValidationIssues: documentState.fieldValidationIssues,
    ready: true,
    structuredFields: documentState.structuredFields,
    text,
    title:
      textOverride === undefined
        ? documentState.title
        : projectStoredDocumentState({
            documentKind: documentState.documentKind,
            structuredFields: documentState.structuredFields,
            text,
          }).title,
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
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const previousDocumentId = state.record?.documentId ?? null;
  const persistedDocumentState = await state.runtime.persistState({
    acceptedPendingUpdateIds: options.acceptedPendingUpdateIds,
    containerId: state.runtime.containerId,
    currentDoc,
    currentRecord: state.record,
    localId: state.localId,
    patch,
    persistence: state.persistence,
  });
  const { record: nextRecord, updatedAt } = persistedDocumentState;
  state.record = persistedDocumentState.record;
  const persistedDocument = {
    accessStateHash: nextRecord.accessStateHash ?? null,
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentKind: nextRecord.documentKind ?? "note",
    documentId: nextRecord.documentId,
    title:
      nextRecord.title ??
      projectStoredDocumentState({
        documentKind: nextRecord.documentKind ?? "note",
        structuredFields: {},
        text: nextRecord.text,
      }).title,
    updatedAt,
  };
  if (previousDocumentId !== nextRecord.documentId) {
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

async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const persistedRecord = await saveDocumentRecord(
    state,
    currentDoc,
    patch,
    options,
  );
  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    persistedRecord.record.text,
  );
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

  const created = await state.runtime.createRemoteDocument({
    missingContainerLogMessage:
      "Documents: cannot create a remote document without a container.",
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    unavailableWriterLogMessage:
      "Documents: skipped remote create because the writer context is unavailable.",
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
  return state.runtime.listPendingUpdates({
    localId: state.localId,
    persistence: state.persistence,
  });
}

async function enqueuePendingUpdate(
  state: DocumentStoreState,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await state.runtime.enqueuePendingUpdate({
    localId: state.localId,
    persistence: state.persistence,
    ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
    update,
  });
}

async function deletePendingAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  await state.runtime.deletePendingAttachment({
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });
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

  await state.runtime.saveLocalAttachments({
    attachments,
    persistence: state.persistence,
  });

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

  const hydratedBlobs = await state.runtime.hydrateAttachmentBlobs({
    attachments: attachmentsMissingLocalBytes,
    documentId: currentRecord.documentId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!hydratedBlobs) {
    return;
  }

  const localAttachmentRecords: LocalAttachmentRecord[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    await state.runtime.writeBlobBytes(
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
  await state.runtime.savePendingAttachment({
    attachment: pendingAttachment,
    persistence: state.persistence,
  });
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

  const nextDoc = await createStoredDocument();
  const persistedState = await state.runtime.loadPersistedStoreState({
    localId: state.localId,
    persistence: state.persistence,
  });
  state.pendingAttachments = persistedState.pendingAttachments;
  state.attachmentStorageKeyBySlotId = Object.fromEntries(
    persistedState.localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.storageKey,
    ]),
  );

  const existing = persistedState.document;
  if (existing) {
    if (existing.loroSnapshot.length > 0) {
      importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
    }

    state.record = existing;
    setReadySnapshot(state, nextDoc, false);
  } else {
    initializeStoredDocumentKind(nextDoc, state.initialDocumentKind);
    if (state.initialText.length > 0) {
      nextDoc.getText("text").update(state.initialText);
    }
    const initialDocumentState = readStoredDocumentState(nextDoc);

    const created: DocumentRecord = {
      id: state.localId,
      containerId: state.runtime.containerId ?? null,
      documentId: state.initialDocumentId,
      documentKind: initialDocumentState.documentKind,
      text: initialDocumentState.text,
      title: initialDocumentState.title,
      loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
      accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
      accessStateHash: null,
      lastCommitLsn: null,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    };
    await saveDocumentRecord(state, nextDoc, created);
    if (state.initialText.length > 0 || state.initialDocumentKind !== "note") {
      await enqueuePendingUpdate(state, exportAllUpdates(nextDoc));
    }
    setReadySnapshot(state, nextDoc, false);
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

      if (isDestroyedDocumentSyncRuntimeError(error)) {
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
    documentKind: state.snapshot.documentKind,
    fieldValidationIssues: state.snapshot.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: state.snapshot.structuredFields,
    text: state.snapshot.text,
    title: state.snapshot.title,
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
    if (isDestroyedDocumentSyncRuntimeError(error)) {
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
    documentKind: nextRecord.documentKind ?? "note",
    documentId: nextRecord.documentId,
    title:
      nextRecord.title ??
      projectStoredDocumentState({
        documentKind: nextRecord.documentKind ?? "note",
        structuredFields: {},
        text: nextRecord.text,
      }).title,
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
    state.runtime.resolveCreateAuthor() !== null
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

  const remoteBindings =
    await state.runtime.listDocumentAttachments(remoteDocumentId);
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
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { pendingAttachment, state } = input;
  const bytes = await state.runtime.readBlobBytes(pendingAttachment.storageKey);
  if (!bytes) {
    state.runtime.log(
      `Documents: pending attachment ${pendingAttachment.slotId} is missing local bytes.`,
    );
    return false;
  }

  const uploaded = await state.runtime.uploadAttachment({
    bytes,
    documentId: input.remoteDocumentId,
    expectedBindingId:
      input.activeBindingBySlotId.get(pendingAttachment.slotId)?.bindingId ??
      null,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    unavailableWriterLogMessage:
      "Documents: skipped attachment upload because the writer context is unavailable.",
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

async function requestRemoteDocumentSync(input: {
  currentDoc: DocumentState;
  currentRecord: DocumentRecord;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingUpdates: PendingUpdateRecord[];
  state: DocumentStoreState;
  unavailableWriterLogMessage: string;
}): Promise<DocumentSyncAttempt | null> {
  const {
    currentDoc,
    currentRecord,
    encapsulationKeyPair,
    pendingUpdates,
    state,
    unavailableWriterLogMessage,
  } = input;

  return state.runtime.syncRemoteDocument({
    documentId: currentRecord.documentId,
    lastCommitLsn: currentRecord.lastCommitLsn,
    localVersionVector: encodeVersionVector(currentDoc),
    pendingUpdates,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    unavailableWriterLogMessage,
  });
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
      acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
    },
  );

  if (syncAttempt.outgoingUpdateCount > synced.settledPendingUpdateIds.length) {
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

  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRemoteRecord,
    pendingUpdates,
    encapsulationKeyPair,
    unavailableWriterLogMessage:
      "Documents: skipped sync because the writer context is unavailable.",
  });
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

  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRecord,
    encapsulationKeyPair,
    pendingUpdates: [],
    unavailableWriterLogMessage:
      "Documents: skipped sync probe because the writer context is unavailable.",
  });
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
    if (isDestroyedDocumentSyncRuntimeError(error)) {
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

  if (hasDocumentUpdateEvent(nextEvents, state.record?.documentId)) {
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

    await state.runtime.writeBlobBytes(
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
    await state.runtime.savePendingAttachment({
      attachment: pendingAttachment,
      persistence: state.persistence,
    });
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
  await state.runtime.writeBlobBytes(storageKey, file.bytes);
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
    documentKind: state.snapshot.documentKind,
    fieldValidationIssues: state.snapshot.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: state.snapshot.structuredFields,
    text: state.snapshot.text,
    title: state.snapshot.title,
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
    documentKind: state.snapshot.documentKind,
    fieldValidationIssues: state.snapshot.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: state.snapshot.structuredFields,
    text: value,
    title: projectStoredDocumentState({
      documentKind: state.snapshot.documentKind,
      structuredFields: state.snapshot.structuredFields,
      text: value,
    }).title,
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

function setDocumentStructuredFields(
  state: DocumentStoreState,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: Partial<DriverLicenseDocumentFields & CreditCardDocumentFields>,
) {
  if (!state.doc) {
    return;
  }

  const nextStructuredFields = {
    ...state.snapshot.structuredFields,
    ...Object.fromEntries(
      Object.entries(patch).filter((entry): entry is [string, string] => {
        const value = entry[1];
        return typeof value === "string";
      }),
    ),
  };
  const projectedState = projectStoredDocumentState({
    documentKind: kind,
    structuredFields: nextStructuredFields,
    text: state.snapshot.text,
  });

  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    documentId: state.snapshot.documentId,
    documentKind: projectedState.documentKind,
    fieldValidationIssues: projectedState.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: projectedState.structuredFields,
    text: state.snapshot.text,
    title: projectedState.title,
    syncing: state.snapshot.syncing,
  });

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc) {
        return;
      }

      const previousVersion = encodeVersionVector(state.doc);
      writeStoredDocumentFields(state.doc, kind, patch);
      const update = exportUpdatesSince(state.doc, previousVersion);
      if (update.byteLength === 0) {
        return;
      }

      await enqueuePendingUpdate(state, update);
      await persistDocument(state, state.doc);
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist structured document changes:", error);
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
  const domainScopeChanged =
    previousRuntime.domainScope !== nextRuntime.domainScope;
  if (nextRuntime.didProjectionKeyRuntimeChange(previousRuntime)) {
    state.resolveProjectionUserKey =
      nextRuntime.createProjectionUserKeyResolver();
  }
  state.runtime = nextRuntime;
  if (domainScopeChanged) {
    state.syncLane = registerDocumentStoreSyncLane(state);
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
    state.runtime.didRegainSyncPrerequisites(previousRuntime)
  ) {
    scheduleSync();
  }
}

function registerDocumentStoreSyncLane(
  state: DocumentStoreState,
): DocumentSyncLane {
  return registerDocumentSyncLane({
    domainScope: state.runtime.domainScope,
    localId: state.localId,
    run: () => runScheduledSyncLoop(state),
  });
}

function createBackingDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStore {
  const state = createDocumentStoreState(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
  state.syncLane = registerDocumentStoreSyncLane(state);
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
    setStructuredFields: (kind, patch) =>
      setDocumentStructuredFields(state, kind, patch),
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
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStoreFacade {
  return createDocumentStoreFacade(
    createBackingDocumentStore(
      localId,
      initialRuntime,
      persistence,
      initialDocumentId,
      initialText,
      initialDocumentKind,
    ),
  );
}

export function createDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStore {
  return createRegisteredDocumentStore(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
}

export function getOrCreateDocumentStore(
  domainScope: object,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
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
    defaultDocumentsPersistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
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
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStore {
  const store = getOrCreateDocumentStore(
    domainScope,
    localId,
    runtime,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
  store.updateRuntime(runtime);
  return store;
}
