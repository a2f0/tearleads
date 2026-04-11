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
import type { BlobBytes, BlobStore } from "../blob-store";
import {
  decryptBlobEnvelope,
  rewrapBlobRecipientEnvelopes,
  serializeBlobEnvelope,
} from "../blobEnvelope";
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
  addDocumentAttachments,
  type DocumentAttachment,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "./documentContent";
import {
  deriveDocumentKind,
  deriveDocumentTitle,
  type LocalAttachmentRecord,
  type NoteRecord,
  type NoteSummary,
  type NotesPersistence,
  type PendingAttachmentRecord,
  type PendingAttachmentReplacementRecord,
  type PendingAttachmentRewrapRecord,
  type PendingUpdateRecord,
  type RelinkPersistedNoteInput,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

type NotesDocument = Awaited<ReturnType<typeof createDocument>>;
type NotesAppData = ReturnType<typeof useAppData>;
type EncapsulationKeyPair = NonNullable<NotesRuntime["encapsulationKeyPair"]>;
type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<NotesRuntime["apiClient"]["listDocumentAttachments"]>>
>[number];
type DocumentEncryptionMaterial = Awaited<
  ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
>;
type DocumentRecipientEnvelopes = ReturnType<
  typeof parseDocumentRecipientEnvelopes
>;
type CommitDocumentChangeResponse = NonNullable<
  Awaited<ReturnType<NotesRuntime["apiClient"]["commitDocumentChange"]>>
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
  nextRecord: NoteRecord;
};
interface DocumentSyncAttempt {
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  encryptionMaterial: DocumentEncryptionMaterial | null;
  outgoingUpdateCount: number;
  synced: NonNullable<
    Awaited<ReturnType<NotesRuntime["apiClient"]["syncDocument"]>>
  >;
}
const DEFAULT_NOTE_ID = "default";
export const DEFAULT_DOCUMENT_ID = DEFAULT_NOTE_ID;

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
  left: Readonly<Record<string, NoteAttachmentStatus>>,
  right: Readonly<Record<string, NoteAttachmentStatus>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([slotId, status]) => right[slotId] === status)
  );
}

export interface NotesRuntime {
  apiClient: Pick<
    NotesAppData["apiClient"],
    | "commitDocumentChange"
    | "createDocument"
    | "getBlob"
    | "listDocumentAttachments"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: NotesAppData["cacheReferencedPrincipalPolicies"];
  containerId: NotesAppData["containerId"];
  dbStatus: NotesAppData["dbStatus"];
  domainScope: NotesAppData["domainScope"];
  encapsulationKeyPair: NotesAppData["encapsulationKeyPair"];
  events: NotesAppData["events"];
  execSql: NotesAppData["execSql"];
  isAuthenticated: NotesAppData["isAuthenticated"];
  log: NotesAppData["log"];
  online: NotesAppData["online"];
}

function createNotesRuntimeApiClient(
  apiClient: NotesAppData["apiClient"],
): NotesRuntime["apiClient"] {
  return {
    commitDocumentChange: apiClient.commitDocumentChange.bind(apiClient),
    createDocument: apiClient.createDocument.bind(apiClient),
    getBlob: apiClient.getBlob.bind(apiClient),
    listDocumentAttachments: apiClient.listDocumentAttachments.bind(apiClient),
    stageBlob: apiClient.stageBlob.bind(apiClient),
    syncDocument: apiClient.syncDocument.bind(apiClient),
  };
}

interface NoteAttachmentUpload {
  bytes: BlobBytes;
  name: string;
  mimeType: string | null;
}

export type DocumentsRuntime = NotesRuntime;
export type DocumentContextValue = NotesContextValue;

export type NoteAttachmentStatus = "needs_replacement" | "syncing";
export type DocumentAttachmentStatus = NoteAttachmentStatus;

interface NotesContextValue {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, NoteAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  setAttachment: (slotId: string, file: NoteAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: NoteAttachmentUpload) => void;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface NotesSnapshot {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, NoteAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
}

interface NotesStore {
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => NotesSnapshot;
  setAttachment: (slotId: string, file: NoteAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: NoteAttachmentUpload) => void;
  requestSync: () => void;
  relink: (input: RelinkPersistedNoteInput) => Promise<NoteSummary | null>;
  setPersistedNoteListener: (
    listener: PersistedNoteListener | undefined,
  ) => void;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: NotesRuntime) => void;
}

type PersistedNoteListener = (note: NoteSummary) => void;

const notesStoresByScope = new WeakMap<object, Map<string, NotesStore>>();
const persistedNoteListenersByScope = new WeakMap<
  object,
  Set<PersistedNoteListener>
>();
const NotesContext = createContext<NotesStore | null>(null);

function emitPersistedNote(
  domainScope: object,
  persistedNote: NoteSummary,
): void {
  const listeners = persistedNoteListenersByScope.get(domainScope);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(persistedNote);
  }
}

function subscribeToPersistedNotes(
  domainScope: object,
  listener: PersistedNoteListener,
): () => void {
  const listeners =
    persistedNoteListenersByScope.get(domainScope) ??
    new Set<PersistedNoteListener>();
  listeners.add(listener);
  persistedNoteListenersByScope.set(domainScope, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      persistedNoteListenersByScope.delete(domainScope);
    }
  };
}

export const subscribeToPersistedDocuments = subscribeToPersistedNotes;

interface NotesStoreState {
  attachmentStorageKeyBySlotId: Record<string, string>;
  doc: NotesDocument | null;
  initialDocumentId: string | null;
  initialText: string;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  noteId: string;
  pendingAttachments: PendingAttachmentRecord[];
  pendingAttachmentReplacements: PendingAttachmentReplacementRecord[];
  pendingAttachmentRewraps: PendingAttachmentRewrapRecord[];
  persistedNoteListener: PersistedNoteListener | undefined;
  persistence: NotesPersistence;
  recipientPublicKeys: Uint8Array[];
  record: NoteRecord | null;
  runtime: NotesRuntime;
  snapshot: NotesSnapshot;
  syncPromise: Promise<void> | null;
  syncRequested: boolean;
  writeChain: Promise<void>;
}

function createNotesStoreState(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence: NotesPersistence,
  persistedNoteListener: PersistedNoteListener | undefined,
  initialDocumentId: string | null,
  initialText = "",
): NotesStoreState {
  return {
    attachmentStorageKeyBySlotId: {},
    doc: null,
    initialDocumentId,
    initialText,
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    listeners: new Set(),
    noteId,
    pendingAttachments: [],
    pendingAttachmentReplacements: [],
    pendingAttachmentRewraps: [],
    persistedNoteListener,
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
    syncPromise: null,
    syncRequested: false,
    writeChain: Promise.resolve(),
  };
}

function emitNotesStore(state: NotesStoreState) {
  for (const listener of state.listeners) {
    listener();
  }
}

function setNotesSnapshot(state: NotesStoreState, next: NotesSnapshot) {
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
  emitNotesStore(state);
}

function updateNoteRecipientPublicKeys(
  state: NotesStoreState,
  encodedPublicKeys: string[],
) {
  state.recipientPublicKeys = resolveRecipientPublicKeys(encodedPublicKeys);
}

function resetNotesStore(state: NotesStoreState) {
  state.doc = null;
  state.record = null;
  state.pendingAttachments = [];
  state.pendingAttachmentReplacements = [];
  state.pendingAttachmentRewraps = [];
  state.attachmentStorageKeyBySlotId = {};
  state.initialized = false;
  state.initializePromise = null;
  state.syncPromise = null;
  state.syncRequested = false;
  state.writeChain = Promise.resolve();
  state.recipientPublicKeys = getLocalRecipientPublicKeys(
    state.runtime.encapsulationKeyPair,
  );
  setNotesSnapshot(state, {
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

function canAttachFiles(state: NotesStoreState): boolean {
  return (
    state.runtime.dbStatus === "ready" && !!state.runtime.encapsulationKeyPair
  );
}

function getSnapshotAttachments(
  state: NotesStoreState,
  currentDoc: NotesDocument | null = state.doc,
): DocumentAttachment[] {
  return currentDoc ? getDocumentAttachments(currentDoc) : [];
}

function getAttachmentStorageKeys(
  state: NotesStoreState,
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
  state: NotesStoreState,
  attachments: ReadonlyArray<DocumentAttachment>,
): Record<string, NoteAttachmentStatus> {
  const pendingAttachmentSlotIds = new Set(
    state.pendingAttachments.map((attachment) => attachment.slotId),
  );
  const replacementSlotIds = new Set(
    state.pendingAttachmentReplacements.map((attachment) => attachment.slotId),
  );
  const nextStatuses: Record<string, NoteAttachmentStatus> = {};

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
  state: NotesStoreState,
  currentDoc: NotesDocument,
  syncing: boolean,
  text = getTextValue(currentDoc),
) {
  const attachments = getSnapshotAttachments(state, currentDoc);

  setNotesSnapshot(state, {
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

async function createNotesDocument() {
  const createdDoc = await createDocument(getScopedPeerSeed("notes"));
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

async function saveNoteRecord(state: NotesStoreState, nextRecord: NoteRecord) {
  await state.persistence.saveNote(state.runtime.execSql, nextRecord);
  state.record = nextRecord;
  const persistedNote = {
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentKind: deriveDocumentKind(nextRecord.text),
    documentId: nextRecord.documentId,
    title: deriveDocumentTitle(nextRecord.text),
    updatedAt: new Date().toISOString(),
  };
  state.persistedNoteListener?.(persistedNote);
  emitPersistedNote(state.runtime.domainScope, persistedNote);
}

async function persistDocument(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  patch: Partial<NoteRecord> = {},
): Promise<NoteRecord> {
  const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
    patch,
    "documentRecipientEnvelopes",
  );
  const nextRecord: NoteRecord = {
    id: state.record?.id ?? state.noteId,
    containerId:
      patch.containerId ??
      state.record?.containerId ??
      state.runtime.containerId ??
      null,
    documentId: patch.documentId ?? state.record?.documentId ?? null,
    documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
      ? (patch.documentRecipientEnvelopes ?? null)
      : (state.record?.documentRecipientEnvelopes ?? null),
    text: patch.text ?? getTextValue(currentDoc),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
    accessEpoch: patch.accessEpoch ?? state.record?.accessEpoch ?? 1,
  };

  await saveNoteRecord(state, nextRecord);
  setReadySnapshot(state, currentDoc, state.snapshot.syncing, nextRecord.text);
  return nextRecord;
}

async function ensureRemoteDocument(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  nextRecord: NoteRecord | null,
): Promise<NoteRecord | null> {
  if (nextRecord?.documentId) {
    return nextRecord;
  }

  if (!state.runtime.containerId) {
    state.runtime.log(
      "Notes: cannot create a remote document without a container.",
    );
    return nextRecord;
  }

  const created = await state.runtime.apiClient.createDocument([
    state.runtime.containerId,
  ]);
  if (!created) {
    return nextRecord;
  }

  await state.runtime.cacheReferencedPrincipalPolicies(
    created.referencedPrincipals,
  );

  updateNoteRecipientPublicKeys(
    state,
    created.recipientEncapsulationPublicKeys,
  );
  state.runtime.log(`Created notes document: ${created.id}`);

  return persistDocument(state, currentDoc, {
    documentId: created.id,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      created.documentRecipientEnvelopes,
    ),
    accessEpoch: created.currentAccessEpoch,
  });
}

async function listPendingUpdates(
  state: NotesStoreState,
): Promise<PendingUpdateRecord[]> {
  return state.persistence.listPendingUpdates(
    state.runtime.execSql,
    state.noteId,
  );
}

async function listPendingAttachmentRecords(
  state: NotesStoreState,
): Promise<PendingAttachmentRecord[]> {
  return state.persistence.listPendingAttachments(
    state.runtime.execSql,
    state.noteId,
  );
}

async function listLocalAttachmentRecords(state: NotesStoreState) {
  return state.persistence.listLocalAttachments(
    state.runtime.execSql,
    state.noteId,
  );
}

async function enqueuePendingUpdate(
  state: NotesStoreState,
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
    noteId: state.noteId,
    ...pendingUpdateFields,
  });
}

async function deletePendingUpdate(state: NotesStoreState, id: string) {
  await state.persistence.deletePendingUpdate(state.runtime.execSql, id);
}

async function saveLocalAttachmentRecord(
  state: NotesStoreState,
  attachment: LocalAttachmentRecord,
  currentDoc: NotesDocument | null = state.doc,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
): DocumentAttachment[] {
  return getDocumentAttachments(currentDoc).filter(
    (attachment) => !state.attachmentStorageKeyBySlotId[attachment.slotId],
  );
}

async function hydrateMissingAttachmentBlob(
  state: NotesStoreState,
  currentDoc: NotesDocument,
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
      `Notes: blob ${binding.blobId} sha256 mismatch during hydration.`,
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
      mimeType: attachment.mimeType,
      noteId: state.noteId,
      slotId: attachment.slotId,
      storageKey,
    },
    currentDoc,
  );
}

async function hydrateAttachmentBlobs(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  currentRecord: NoteRecord | null,
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
  state: NotesStoreState,
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
  state: NotesStoreState,
  slotId: string,
  blobId: string,
): Promise<PendingAttachmentRewrapRecord> {
  const pendingAttachmentRewrap: PendingAttachmentRewrapRecord = {
    blobId,
    noteId: state.noteId,
    slotId,
  };
  await state.persistence.savePendingAttachmentRewrap(
    state.runtime.execSql,
    pendingAttachmentRewrap,
  );
  return pendingAttachmentRewrap;
}

async function createPendingAttachmentReplacement(
  state: NotesStoreState,
  slotId: string,
  blobId: string | null,
): Promise<PendingAttachmentReplacementRecord> {
  const pendingAttachmentReplacement: PendingAttachmentReplacementRecord = {
    blobId,
    noteId: state.noteId,
    slotId,
  };
  await state.persistence.savePendingAttachmentReplacement(
    state.runtime.execSql,
    pendingAttachmentReplacement,
  );
  return pendingAttachmentReplacement;
}

function mergePendingAttachmentRewraps(
  state: NotesStoreState,
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
  state: NotesStoreState,
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
  state: NotesStoreState,
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
      state.noteId,
      slotId,
    );
  }
}

function upsertPendingAttachments(
  state: NotesStoreState,
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
  state: NotesStoreState,
  attachment: DocumentAttachment,
  storageKey: string,
): Promise<PendingAttachmentRecord> {
  const pendingAttachment: PendingAttachmentRecord = {
    byteLength: attachment.byteLength,
    mimeType: attachment.mimeType,
    name: attachment.name,
    noteId: state.noteId,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
  sourceVersionVector?: string | null,
) {
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    state.noteId,
  );
  await enqueuePendingUpdate(
    state,
    exportAllUpdates(currentDoc),
    sourceVersionVector,
  );
}

async function initializeNotesStore(
  state: NotesStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  await state.persistence.ensureSchema(state.runtime.execSql);

  const nextDoc = await createNotesDocument();
  const [
    existing,
    loadedPendingAttachments,
    loadedPendingAttachmentReplacements,
    loadedPendingAttachmentRewraps,
    localAttachments,
  ] = await Promise.all([
    state.persistence.loadNote(state.runtime.execSql, state.noteId),
    listPendingAttachmentRecords(state),
    state.persistence.listPendingAttachmentReplacements(
      state.runtime.execSql,
      state.noteId,
    ),
    state.persistence.listPendingAttachmentRewraps(
      state.runtime.execSql,
      state.noteId,
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

    const created: NoteRecord = {
      id: state.noteId,
      containerId: state.runtime.containerId ?? null,
      documentId: state.initialDocumentId,
      documentRecipientEnvelopes: null,
      text: state.initialText,
      loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
      accessEpoch: 1,
    };
    await saveNoteRecord(state, created);
    setReadySnapshot(state, nextDoc, false, state.initialText);
  }

  state.doc = nextDoc;
  state.initialized = true;
  state.initializePromise = null;
  scheduleSync();
}

function ensureNotesStoreInitialized(
  state: NotesStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeNotesStore(state, scheduleSync).catch(
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

function isDestroyedDatabaseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

function setNotesSyncing(state: NotesStoreState, syncing: boolean) {
  setNotesSnapshot(state, {
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

async function awaitInitializationForSync(state: NotesStoreState) {
  if (!state.initializePromise) {
    return true;
  }

  try {
    await state.initializePromise;
    return true;
  } catch (error) {
    if (isDestroyedDatabaseError(error)) {
      return false;
    }

    throw error;
  }
}

async function ensureNotesStoreReady(
  state: NotesStoreState,
  scheduleSync: () => void,
): Promise<boolean> {
  ensureNotesStoreInitialized(state, scheduleSync);

  if (state.initialized) {
    return true;
  }

  if (!state.initializePromise) {
    return false;
  }

  return awaitInitializationForSync(state);
}

async function relinkNotesStore(
  state: NotesStoreState,
  input: RelinkPersistedNoteInput,
): Promise<NoteSummary | null> {
  if (!state.doc) {
    return null;
  }

  const currentAccessEpoch = state.record?.accessEpoch ?? 1;
  const patch: Partial<NoteRecord> = {
    accessEpoch: Math.max(currentAccessEpoch, input.accessEpoch),
    containerId: input.containerId,
    documentId: input.documentId,
  };

  if (input.accessEpoch > currentAccessEpoch) {
    patch.documentRecipientEnvelopes = null;
  }

  const nextRecord = await persistDocument(state, state.doc, patch);
  return {
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentId: nextRecord.documentId,
    title: deriveDocumentTitle(nextRecord.text),
    updatedAt: new Date().toISOString(),
  };
}

function canRunScheduledSync(state: NotesStoreState): boolean {
  return (
    state.doc !== null &&
    state.snapshot.ready &&
    state.runtime.online &&
    state.runtime.isAuthenticated &&
    state.runtime.encapsulationKeyPair !== null
  );
}

async function buildAttachmentCommits(
  state: NotesStoreState,
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
        `Notes: missing local blob bytes for attachment ${attachment.slotId}.`,
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
  state: NotesStoreState,
  attachmentsToRewrap: PendingAttachmentRewrapRecord[],
  currentBindings: ReadonlyArray<DocumentAttachmentBinding>,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<AttachmentRewrapChange[] | null> {
  const currentBindingBySlotId = new Map(
    currentBindings.map((binding) => [binding.slotId, binding]),
  );
  const blobById = new Map<
    string,
    Awaited<ReturnType<NotesRuntime["apiClient"]["getBlob"]>>
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
  nextRemoteRecord: NoteRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  attachmentCommits: AttachmentCommitChange[],
  attachmentRewraps: AttachmentRewrapChange[],
  sourceVersionVector: string | null,
): Promise<CommitDocumentChangeResponse | null> {
  if (!nextRemoteRecord.documentId) {
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
      attachmentCommits,
      attachmentDetaches: [],
      attachmentRewraps,
      documentRecipientEnvelopes,
      loroUpdate: {
        encryptedData: encryptedBaseline,
        id: crypto.randomUUID(),
        partialEndVersionVector: baselineUpdateFields.partialEndVersionVector,
        partialStartVersionVector:
          baselineUpdateFields.partialStartVersionVector,
        referencedSlotIds: getDocumentAttachments(currentDoc).map(
          (attachment) => attachment.slotId,
        ),
        ...(sourceVersionVector ? { sourceVersionVector } : {}),
      },
    },
  );
}

async function commitAttachmentRewrapChange(
  state: NotesStoreState,
  nextRemoteRecord: NoteRecord,
  attachmentRewraps: AttachmentRewrapChange[],
): Promise<CommitDocumentChangeResponse | null> {
  if (!nextRemoteRecord.documentId) {
    return null;
  }

  return state.runtime.apiClient.commitDocumentChange(
    nextRemoteRecord.documentId,
    {
      accessEpoch: nextRemoteRecord.accessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps,
      loroUpdate: null,
    },
  );
}

async function saveCommittedAttachmentRecords(
  state: NotesStoreState,
  currentDoc: NotesDocument,
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
        mimeType: localAttachment.mimeType,
        noteId: state.noteId,
        slotId: localAttachment.slotId,
        storageKey: localAttachment.storageKey,
      },
      currentDoc,
    );
  }
}

function getCurrentSyncState(state: NotesStoreState): {
  currentDoc: NotesDocument;
  currentRecord: NoteRecord;
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
  state: NotesStoreState,
  documentId: string,
): Promise<ReadonlyArray<DocumentAttachmentBinding> | null> {
  return state.runtime.apiClient.listDocumentAttachments(documentId);
}

async function runSerializedMutation(
  state: NotesStoreState,
  nextRecord: NoteRecord,
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
  state: NotesStoreState,
  nextRecord: NoteRecord,
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
  state: NotesStoreState,
  nextRecord: NoteRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0) {
    return { completed: false, nextRecord };
  }

  return runSerializedMutation(
    state,
    nextRecord,
    "Failed to sync note attachments:",
    () => runPendingAttachmentSyncTask(state, nextRecord, encapsulationKeyPair),
  );
}

async function clearSyncedPendingAttachments(
  state: NotesStoreState,
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
    state.noteId,
  );
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    state.noteId,
  );
  await clearPendingAttachmentReplacementsForSlots(
    state,
    Array.from(committedSlotIds),
  );
}

async function persistCommittedDocumentRecord(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  documentId: string,
  committed: CommitDocumentChangeResponse,
): Promise<NoteRecord> {
  return persistDocument(state, currentDoc, {
    accessEpoch: committed.currentAccessEpoch,
    documentId,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      committed.documentRecipientEnvelopes,
    ),
  });
}

async function finalizePendingAttachmentSync(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  documentId: string,
  attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
  committed: CommitDocumentChangeResponse,
): Promise<NoteRecord> {
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

async function clearPendingAttachmentRewraps(state: NotesStoreState) {
  state.pendingAttachmentRewraps = [];
  await state.persistence.deletePendingAttachmentRewraps(
    state.runtime.execSql,
    state.noteId,
  );
}

async function clearSyncedPendingAttachmentRewraps(
  state: NotesStoreState,
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
    state.noteId,
  );
}

async function clearEmptyPendingAttachmentRewraps(
  state: NotesStoreState,
  nextRecord: NoteRecord,
): Promise<PendingMutationSyncResult> {
  await clearPendingAttachmentRewraps(state);
  return { completed: false, nextRecord };
}

async function finalizePendingAttachmentRewrapSync(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  documentId: string,
  attachmentsToRewrap: ReadonlyArray<PendingAttachmentRewrapRecord>,
  committed: CommitDocumentChangeResponse,
): Promise<NoteRecord> {
  await clearSyncedPendingAttachmentRewraps(state, attachmentsToRewrap);
  return persistCommittedDocumentRecord(
    state,
    currentDoc,
    documentId,
    committed,
  );
}

async function runPendingAttachmentRewrapTask(
  state: NotesStoreState,
  nextRecord: NoteRecord,
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
  state: NotesStoreState,
  nextRecord: NoteRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachmentRewraps.length === 0) {
    return { completed: false, nextRecord };
  }

  return runSerializedMutation(
    state,
    nextRecord,
    "Failed to rewrap note attachments:",
    () =>
      runPendingAttachmentRewrapTask(state, nextRecord, encapsulationKeyPair),
  );
}

async function ensureDocumentRecordForSync(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  nextRecord: NoteRecord,
  pendingUpdates: PendingUpdateRecord[],
): Promise<NoteRecord | null> {
  if (nextRecord.documentId || pendingUpdates.length === 0) {
    return nextRecord;
  }

  return ensureRemoteDocument(state, currentDoc, nextRecord);
}

async function requestDocumentSync(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  currentRecord: NoteRecord,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
  currentRecord: NoteRecord,
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
  currentRecord: NoteRecord,
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
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
      "Notes: skipped incoming updates because the current document key bundle is missing.",
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
      (message) => state.runtime.log(`Notes: ${message}`),
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
  state: NotesStoreState,
  currentDoc: NotesDocument,
  currentRecord: NoteRecord,
  syncAttempt: DocumentSyncAttempt,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<NoteRecord> {
  const { synced } = syncAttempt;
  updateNoteRecipientPublicKeys(state, synced.recipientEncapsulationPublicKeys);

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

  const nextRecord = await persistDocument(state, currentDoc, {
    documentId: currentRecord.documentId,
    accessEpoch: synced.currentAccessEpoch,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      nextDocumentRecipientEnvelopes,
    ),
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
          "Notes: document epoch rotated; committed attachments were queued for replacement.",
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
    state.syncRequested = true;
  }

  if (
    synced.canonicalDocumentRecipientEnvelopesAdopted ||
    syncAttempt.outgoingUpdateCount > synced.acceptedOutgoingUpdateIds.length
  ) {
    state.syncRequested = true;
  }

  if (!rotatedAccessEpoch) {
    await hydrateAttachmentBlobs(state, currentDoc, nextRecord);
  }
  return nextRecord;
}

async function syncDocumentState(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  nextRecord: NoteRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<NoteRecord> {
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

async function refreshRemoteDocumentBeforePendingAttachmentCommit(
  state: NotesStoreState,
  currentDoc: NotesDocument,
  nextRecord: NoteRecord,
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

async function runNotesSyncPass(state: NotesStoreState) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  let nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
    return;
  }

  const refreshedResult =
    await refreshRemoteDocumentBeforePendingAttachmentCommit(
      state,
      currentDoc,
      nextRecord,
      encapsulationKeyPair,
    );
  nextRecord = refreshedResult.nextRecord;
  if (refreshedResult.completed) {
    state.syncRequested = true;
    return;
  }

  const attachmentResult = await syncPendingAttachments(
    state,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = attachmentResult.nextRecord;
  if (attachmentResult.completed) {
    state.syncRequested = true;
    return;
  }

  const rewrapResult = await syncPendingAttachmentRewraps(
    state,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = rewrapResult.nextRecord;
  if (rewrapResult.completed) {
    state.syncRequested = true;
    return;
  }

  if (state.pendingAttachmentReplacements.length > 0) {
    return;
  }

  await syncDocumentState(state, currentDoc, nextRecord, encapsulationKeyPair);
}

async function runScheduledSyncIteration(state: NotesStoreState) {
  if (!(await awaitInitializationForSync(state))) {
    return false;
  }

  if (!canRunScheduledSync(state)) {
    return true;
  }

  try {
    await runNotesSyncPass(state);
    return true;
  } catch (error) {
    if (isDestroyedDatabaseError(error)) {
      return false;
    }

    throw error;
  } finally {
    setNotesSyncing(state, false);
  }
}

async function runScheduledSyncLoop(state: NotesStoreState) {
  setNotesSyncing(state, true);

  try {
    while (state.syncRequested) {
      state.syncRequested = false;

      const shouldContinue = await runScheduledSyncIteration(state);
      if (!shouldContinue) {
        return;
      }
    }
  } finally {
    setNotesSyncing(state, false);
  }
}

function scheduleNotesSync(state: NotesStoreState) {
  state.syncRequested = true;

  if (state.syncPromise) {
    return;
  }

  state.syncPromise = (async () => {
    try {
      await runScheduledSyncLoop(state);
    } catch (error) {
      console.error("Failed to sync notes:", error);
    } finally {
      const shouldRetry = state.syncRequested;
      state.syncPromise = null;
      if (shouldRetry) {
        scheduleNotesSync(state);
      }
    }
  })();
}

function handleNotesRemoteEvents(
  state: NotesStoreState,
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
  noteId: string,
  files: ReadonlyArray<NoteAttachmentUpload>,
): {
  nextAttachments: DocumentAttachment[];
  nextPendingAttachments: PendingAttachmentRecord[];
} {
  const nextPendingAttachments: PendingAttachmentRecord[] = [];
  const nextAttachments: DocumentAttachment[] = [];

  for (const file of files) {
    const slotId = crypto.randomUUID();
    const storageKey = `${noteId}-${slotId}`;
    nextPendingAttachments.push({
      byteLength: file.bytes.byteLength,
      mimeType: file.mimeType,
      name: file.name,
      noteId,
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
  state: NotesStoreState,
  files: ReadonlyArray<NoteAttachmentUpload>,
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
      mimeType: pendingAttachment.mimeType,
      noteId: state.noteId,
      slotId: pendingAttachment.slotId,
      storageKey: pendingAttachment.storageKey,
    });
    await state.persistence.savePendingAttachment(
      state.runtime.execSql,
      pendingAttachment,
    );
  }
}

function logAttachedFiles(state: NotesStoreState, count: number) {
  state.runtime.log(
    state.runtime.online && state.runtime.isAuthenticated
      ? `Attached ${count} file${count === 1 ? "" : "s"} to note ${state.noteId}.`
      : `Stored ${count} attachment${count === 1 ? "" : "s"} locally for note ${state.noteId}.`,
  );
}

async function persistAttachedFiles(
  state: NotesStoreState,
  files: ReadonlyArray<NoteAttachmentUpload>,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.log("Notes: attachments require a local key package.");
    return;
  }

  const { nextAttachments, nextPendingAttachments } = buildPendingAttachments(
    state.noteId,
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
  scheduleNotesSync(state);
}

async function persistSlotAttachmentFile(
  state: NotesStoreState,
  slotId: string,
  file: NoteAttachmentUpload,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.log("Notes: slot attachments require a local key package.");
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

  const storageKey = `${state.noteId}-${slotId}-${crypto.randomUUID()}`;
  await state.runtime.blobStore.writeBytes(storageKey, file.bytes);
  await saveLocalAttachmentRecord(state, {
    blobId: null,
    byteLength: replacementAttachment.byteLength,
    mimeType: replacementAttachment.mimeType,
    noteId: state.noteId,
    slotId,
    storageKey,
  });
  await queuePendingAttachmentUpload(state, replacementAttachment, storageKey);
  await persistDocument(state, currentDoc);
  state.runtime.log(`Queued attachment ${file.name} for slot ${slotId}.`);
  scheduleNotesSync(state);
}

function refreshAttachabilitySnapshot(state: NotesStoreState) {
  if (!state.snapshot.ready) {
    return;
  }

  setNotesSnapshot(state, {
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

function regainedSyncPrerequisites(
  previousRuntime: NotesRuntime,
  nextRuntime: NotesRuntime,
): boolean {
  return (
    (!previousRuntime.online && nextRuntime.online) ||
    (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
    (!previousRuntime.encapsulationKeyPair &&
      !!nextRuntime.encapsulationKeyPair)
  );
}

function attachFilesToNotesStore(
  state: NotesStoreState,
  files: ReadonlyArray<NoteAttachmentUpload>,
) {
  if (files.length === 0 || !state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistAttachedFiles(state, files))
    .catch((error: unknown) => {
      console.error("Failed to attach note files:", error);
    });
}

function replaceAttachmentInNotesStore(
  state: NotesStoreState,
  slotId: string,
  file: NoteAttachmentUpload,
) {
  if (!state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistSlotAttachmentFile(state, slotId, file))
    .catch((error: unknown) => {
      console.error("Failed to replace note attachment:", error);
    });
}

function setAttachmentInNotesStore(
  state: NotesStoreState,
  slotId: string,
  file: NoteAttachmentUpload,
) {
  replaceAttachmentInNotesStore(state, slotId, file);
}

function setNotesText(state: NotesStoreState, value: string) {
  if (!state.doc) {
    return;
  }

  setNotesSnapshot(state, {
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
      scheduleNotesSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist note changes:", error);
    });
}

function subscribeToNotesStore(state: NotesStoreState, listener: () => void) {
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

function updateNotesStoreRuntime(
  state: NotesStoreState,
  nextRuntime: NotesRuntime,
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
      resetNotesStore(state);
    }
    state.lastEventCount = nextRuntime.events.length;
    return;
  }

  refreshAttachabilitySnapshot(state);
  ensureNotesStoreInitialized(state, scheduleSync);
  handleNotesRemoteEvents(state, scheduleSync);

  if (
    state.snapshot.ready &&
    regainedSyncPrerequisites(previousRuntime, state.runtime)
  ) {
    scheduleSync();
  }
}

function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence: NotesPersistence = sqlDocumentsPersistence,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
  initialText = "",
): NotesStore {
  const state = createNotesStoreState(
    noteId,
    initialRuntime,
    persistence,
    onPersistedNote,
    initialDocumentId,
    initialText,
  );
  const scheduleSync = () => scheduleNotesSync(state);

  return {
    attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) =>
      attachFilesToNotesStore(state, files),
    ensureInitialized: () => ensureNotesStoreReady(state, scheduleSync),
    getSnapshot: () => state.snapshot,
    setAttachment: (slotId: string, file: NoteAttachmentUpload) =>
      setAttachmentInNotesStore(state, slotId, file),
    replaceAttachment: (slotId: string, file: NoteAttachmentUpload) =>
      replaceAttachmentInNotesStore(state, slotId, file),
    requestSync: () => scheduleSync(),
    relink: (input) => relinkNotesStore(state, input),
    setPersistedNoteListener: (listener) => {
      state.persistedNoteListener = listener;
    },
    setText: (value: string) => setNotesText(state, value),
    subscribe: (listener: () => void) => subscribeToNotesStore(state, listener),
    updateRuntime: (runtime: NotesRuntime) =>
      updateNotesStoreRuntime(state, runtime, scheduleSync),
  };
}

export const createDocumentStore = createNotesStore;

function getOrCreateNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
  initialText = "",
): NotesStore {
  const existingStores = notesStoresByScope.get(domainScope);
  if (existingStores) {
    const existingStore = existingStores.get(noteId);
    if (existingStore) {
      existingStore.setPersistedNoteListener(onPersistedNote);
      return existingStore;
    }
  }

  const nextStore = createNotesStore(
    noteId,
    runtime,
    sqlDocumentsPersistence,
    onPersistedNote,
    initialDocumentId,
    initialText,
  );
  const stores = existingStores ?? new Map<string, NotesStore>();
  stores.set(noteId, nextStore);
  notesStoresByScope.set(domainScope, stores);
  return nextStore;
}

function primeNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
  initialText = "",
): NotesStore {
  const store = getOrCreateNotesStore(
    domainScope,
    noteId,
    runtime,
    onPersistedNote,
    initialDocumentId,
    initialText,
  );
  store.updateRuntime(runtime);
  return store;
}

export const primeDocumentStore = primeNotesStore;

function requestDomainNotesSync(domainScope: object): void {
  const stores = notesStoresByScope.get(domainScope);
  if (!stores) {
    return;
  }

  for (const store of stores.values()) {
    store.requestSync();
  }
}

export const requestDomainDocumentSync = requestDomainNotesSync;

interface DocumentsProviderProps extends PropsWithChildren {
  localId?: string;
  containerId?: string | null;
  documentId?: string | null;
  initialText?: string;
  onPersistedDocument?: PersistedNoteListener;
}

export function DocumentsProvider({
  children,
  localId = DEFAULT_DOCUMENT_ID,
  containerId,
  documentId = null,
  initialText = "",
  onPersistedDocument,
}: DocumentsProviderProps) {
  const appData = useAppData();
  const runtime = useMemo<NotesRuntime>(
    () => ({
      apiClient: createNotesRuntimeApiClient(appData.apiClient),
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
      getOrCreateNotesStore(
        runtime.domainScope,
        localId,
        runtime,
        onPersistedDocument,
        documentId,
        initialText,
      ),
    [
      documentId,
      initialText,
      localId,
      onPersistedDocument,
      runtime.domainScope,
    ],
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
    <NotesContext.Provider value={store}>{children}</NotesContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const store = useContext(NotesContext);
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
