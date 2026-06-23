import type { createDocument } from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { DocumentSummary } from "../../../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
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
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/types";
import type { DomainScope } from "../../../data/domainScope";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionUserKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
  type DocumentsPersistence,
  type PendingAttachmentRecord,
} from "../../../workflows/documents";
import type {
  DocumentAttachmentStatus,
  DocumentSnapshot,
  DocumentsRuntime,
} from "../types";

export type DocumentState = Awaited<ReturnType<typeof createDocument>>;
export type EncapsulationKeyPair = NonNullable<
  DocumentsRuntime["crypto"]["encapsulationKeyPair"]
>;
export type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<DocumentsRuntime["apiClient"]["listDocumentAttachments"]>>
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
export interface DocumentSyncAttempt {
  outgoingUpdateCount: number;
  synced: SyncRemoteDocumentResult;
}

export interface DocumentStorePersistenceEffects {
  emitPersistedDocument: (
    domainScope: DomainScope,
    persistedDocument: DocumentSummary,
  ) => void;
  registerDocumentIdentity: (
    domainScope: DomainScope,
    localId: string,
    documentId: string | null,
  ) => void;
}

export interface DocumentStoreState {
  attachmentBlobIdBySlotId: Record<string, string | null>;
  attachmentStorageKeyBySlotId: Record<string, string>;
  doc: DocumentState | null;
  effects: DocumentStorePersistenceEffects;
  initialDocumentId: string | null;
  initialDocumentKind: StoredDocumentKind;
  initialText: string;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  locallyAcceptedUpdateIds: Set<string>;
  localId: string;
  listeners: Set<() => void>;
  pendingAttachments: PendingAttachmentRecord[];
  persistence: DocumentsPersistence;
  record: DocumentRecord | null;
  resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
  remoteUpdatePending: boolean;
  /**
   * Monotonically incremented every time a remote update event sets
   * `remoteUpdatePending`. A sync pass snapshots this when it consumes the
   * signal so it can tell, after its async network/persist window, whether a
   * NEW remote event arrived mid-pass. Without this a boolean alone cannot
   * distinguish "the signal I consumed" from "a fresh signal that arrived
   * during the await", and clearing it unconditionally drops the new event —
   * stalling convergence until an unrelated trigger re-arms the lane.
   */
  remoteUpdateSignalSeq: number;
  runtime: DocumentsRuntime;
  snapshot: DocumentSnapshot;
  syncLane: DocumentSyncLane | null;
  writeChain: Promise<void>;
  writerProjection: DocumentWriterProjectionResponse | null;
}

const EMPTY_DOCUMENT_SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: false,
  documentId: null,
  documentKind: DEFAULT_DOCUMENT_KIND,
  fieldValidationIssues: [],
  ready: false,
  structuredFields: {},
  text: "",
  title: "",
  syncing: false,
};

function shallowEqualRecord<Value>(
  left: Readonly<Record<string, Value>>,
  right: Readonly<Record<string, Value>>,
): boolean {
  let leftKeyCount = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) {
      continue;
    }

    leftKeyCount += 1;
    if (!Object.hasOwn(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }

  let rightKeyCount = 0;
  for (const key in right) {
    if (Object.hasOwn(right, key)) {
      rightKeyCount += 1;
    }
  }

  return leftKeyCount === rightKeyCount;
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
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStoreState {
  return {
    attachmentBlobIdBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    doc: null,
    effects,
    initialDocumentId,
    initialDocumentKind,
    initialText,
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    locallyAcceptedUpdateIds: new Set(),
    localId,
    listeners: new Set(),
    pendingAttachments: [],
    persistence,
    record: null,
    resolveProjectionUserKey:
      createDocumentProjectionUserKeyResolver(initialRuntime),
    remoteUpdatePending: false,
    remoteUpdateSignalSeq: 0,
    runtime: initialRuntime,
    snapshot: { ...EMPTY_DOCUMENT_SNAPSHOT },
    syncLane: null,
    writeChain: Promise.resolve(),
    writerProjection: null,
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
    shallowEqualRecord(
      state.snapshot.attachmentStatusBySlotId,
      next.attachmentStatusBySlotId,
    ) &&
    shallowEqualRecord(
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
    shallowEqualRecord(
      state.snapshot.structuredFields,
      next.structuredFields,
    ) &&
    state.snapshot.text === next.text &&
    state.snapshot.title === next.title &&
    state.snapshot.syncing === next.syncing
  ) {
    return;
  }

  state.snapshot = next;
  emitDocumentStore(state);
}

function clearDocumentStoreState(
  state: DocumentStoreState,
  { initialized }: { initialized: boolean },
) {
  state.doc = null;
  state.record = null;
  state.pendingAttachments = [];
  state.attachmentBlobIdBySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  state.locallyAcceptedUpdateIds = new Set();
  state.remoteUpdatePending = false;
  state.remoteUpdateSignalSeq = 0;
  state.writerProjection = null;
  state.initialized = initialized;
  state.initializePromise = null;
  state.writeChain = Promise.resolve();
  setDocumentSnapshot(state, { ...EMPTY_DOCUMENT_SNAPSHOT });
}

export function resetDocumentStore(state: DocumentStoreState) {
  clearDocumentStoreState(state, { initialized: false });
}

export function markDocumentStoreRemoved(state: DocumentStoreState) {
  clearDocumentStoreState(state, { initialized: true });
}

export function canAttachFiles(state: DocumentStoreState): boolean {
  return (
    state.runtime.infra.dbStatus === "ready" &&
    !!state.runtime.crypto.encapsulationKeyPair
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
    state.runtime.infra.documentProjectors,
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
            state.runtime.infra.documentProjectors,
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
