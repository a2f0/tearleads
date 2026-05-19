import type { createDocument } from "@tearleads/loro";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  type DocumentAttachment,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "../../../data/documents/documentContent";
import {
  projectStoredDocumentState,
  readStoredDocumentState,
  type StoredDocumentKind,
} from "../../../data/documents/documentKinds";
import type {
  DocumentProjectionUserKeyResolver,
  DocumentRecord,
  DocumentSyncLane,
  DocumentsPersistence,
  PendingAttachmentRecord,
} from "../../../workflows/documents";
import type {
  DocumentAttachmentStatus,
  DocumentSnapshot,
  DocumentsRuntime,
} from "../types";

export type DocumentState = Awaited<ReturnType<typeof createDocument>>;
export type EncapsulationKeyPair = NonNullable<
  DocumentsRuntime["encapsulationKeyPair"]
>;
export type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["listDocumentAttachments"]>>
>[number];
export type PendingMutationSyncResult = {
  completed: boolean;
  nextRecord: DocumentRecord;
};
export interface PersistedDocumentRecord {
  record: DocumentRecord;
  updatedAt: string;
}
export interface SaveDocumentRecordOptions {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
}
export type DocumentSyncAttempt = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["syncRemoteDocument"]>>
>;

export interface DocumentStorePersistenceEffects {
  emitPersistedDocument: (
    domainScope: object,
    persistedDocument: DocumentSummary,
  ) => void;
  registerDocumentIdentity: (
    domainScope: object,
    localId: string,
    documentId: string | null,
  ) => void;
}

export interface DocumentStoreState {
  attachmentStorageKeyBySlotId: Record<string, string>;
  doc: DocumentState | null;
  effects: DocumentStorePersistenceEffects;
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

export function createDocumentStoreState(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence,
  effects: DocumentStorePersistenceEffects,
  initialDocumentId: string | null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = "note",
): DocumentStoreState {
  return {
    attachmentStorageKeyBySlotId: {},
    doc: null,
    effects,
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

export function setDocumentSnapshot(
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

export function resetDocumentStore(state: DocumentStoreState) {
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

export function canAttachFiles(state: DocumentStoreState): boolean {
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

export function setReadySnapshot(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  syncing: boolean,
  textOverride?: string,
) {
  const attachments = getSnapshotAttachments(state, currentDoc);
  const documentState = readStoredDocumentState(
    currentDoc,
    state.runtime.documentProjectors,
  );
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
        : projectStoredDocumentState(
            {
              documentKind: documentState.documentKind,
              structuredFields: documentState.structuredFields,
              text,
            },
            state.runtime.documentProjectors,
          ).title,
    syncing,
  });
}

export function setDocumentSyncing(
  state: DocumentStoreState,
  syncing: boolean,
) {
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

export function refreshAttachabilitySnapshot(state: DocumentStoreState) {
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

export function subscribeToDocumentStore(
  state: DocumentStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}
