import type { createDocument } from "@symcrypt/loro";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  canWriteEffectiveAccessLevel,
  normalizeEffectiveAccessLevel,
} from "../../../data/accessLevel";
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
import {
  type DocumentRow,
  listDocumentRows,
  sameDocumentRows,
} from "../../../data/documents/documentRowList";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import type { DocumentSyncPullContinuation } from "../../../data/documents/shared/syncPagination";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/types";
import type { DomainScope } from "../../../data/domainScope";
import {
  type AttachmentRemovalRows,
  type AttachmentStagingRows,
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionUserKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
  type DocumentsPersistence,
  type PendingAttachmentRecord,
  type PendingUpdateInsert,
  resolveDocumentCreateAuthor,
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
  creationSuperseded?: true;
  historyRestoreState?:
    | Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>
    | undefined;
  pullContinuationSuperseded?: true;
  record: DocumentRecord;
  syncIdentitySuperseded?: true;
  updatedAt?: string | undefined;
}
export interface SaveDocumentRecordOptions {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  attachmentRemoval?: AttachmentRemovalRows | undefined;
  attachmentStaging?: AttachmentStagingRows | undefined;
  clearSyncFailure?: boolean | undefined;
  expectedSyncState?:
    | {
        pullContinuation: DocumentSyncPullContinuation | null;
        record: DocumentRecord;
      }
    | undefined;
  historyCheckpoint?:
    | {
        coveredTailIds: readonly string[];
        endVersionVector: string;
        snapshot: string;
      }
    | undefined;
  historyUpdateOrigin?: "local" | "remote" | undefined;
  historyUpdates?: readonly string[] | undefined;
  pendingUpdate?: Omit<PendingUpdateInsert, "localId"> | undefined;
  pendingBaseVersionOverride?: string | null | undefined;
  preserveSnapshotStructuredFields?: boolean | undefined;
  preserveSnapshotText?: boolean | undefined;
}
export interface DocumentSyncAttempt {
  consumedPullContinuation: DocumentSyncPullContinuation | null;
  outgoingUpdateCount: number;
  requestRecord: DocumentRecord;
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
  /** Invalidates queued local-write closures when this store is cleared. */
  localWriteGeneration: number;
  locallyAcceptedUpdateIds: Set<string>;
  localId: string;
  listeners: Set<() => void>;
  pendingAttachments: PendingAttachmentRecord[];
  /**
   * Oplog version through which every op in `doc` is already durably enqueued as
   * a pending update or synced from a remote peer. It advances only after an
   * edit's enqueue+persist succeeds, so a later edit can recover any orphaned
   * delta left by a failed write instead of silently dropping it from sync.
   * `null` only before initialization sets it to the loaded doc's version.
   */
  pendingBaseVersion: string | null;
  /**
   * Local text/structured writes queued on `writeChain` but not yet drained.
   * While positive, sync MUST preserve the optimistic text/fields because `doc`
   * can lag the latest keystroke. Remote merges remain in `doc` and publish when
   * the final write settles.
   */
  pendingLocalWrites: number;
  persistence: DocumentsPersistence;
  /**
   * Durable continuation for a bounded remote pull, mirrored from the document
   * record so the live lane can advance it without re-reading SQLite.
   */
  pullContinuation: DocumentSyncPullContinuation | null;
  record: DocumentRecord | null;
  /**
   * Consecutive completed sync passes that re-keyed conflicted pending updates
   * without settling anything. Bounds the rekey-driven self re-arm so a server
   * that keeps conflicting fresh ids cannot drive a network-speed loop; see
   * shouldReArmAfterOutgoingSettlement.
   */
  rekeyOnlyPassCount: number;
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
  canWrite: true,
  currentAuthorId: null,
  documentId: null,
  documentKind: DEFAULT_DOCUMENT_KIND,
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: false,
  rows: [],
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
    if (!Object.hasOwn(left, key)) continue;

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
    localWriteGeneration: 0,
    locallyAcceptedUpdateIds: new Set(),
    localId,
    listeners: new Set(),
    pendingAttachments: [],
    pendingBaseVersion: null,
    pendingLocalWrites: 0,
    persistence,
    pullContinuation: null,
    record: null,
    rekeyOnlyPassCount: 0,
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
    state.snapshot.canWrite === next.canWrite &&
    state.snapshot.currentAuthorId === next.currentAuthorId &&
    state.snapshot.documentId === next.documentId &&
    state.snapshot.documentKind === next.documentKind &&
    state.snapshot.effectiveAccessLevel === next.effectiveAccessLevel &&
    sameValidationIssues(
      state.snapshot.fieldValidationIssues,
      next.fieldValidationIssues,
    ) &&
    state.snapshot.ready === next.ready &&
    sameDocumentRows(state.snapshot.rows, next.rows) &&
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
  state.localWriteGeneration += 1;
  state.record = null;
  state.pendingAttachments = [];
  state.pendingBaseVersion = null;
  state.pendingLocalWrites = 0;
  state.pullContinuation = null;
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
    canWriteDocument(state) &&
    state.runtime.infra.dbStatus === "ready" &&
    !!state.runtime.crypto.encapsulationKeyPair
  );
}

export function canWriteDocument(state: DocumentStoreState): boolean {
  return canWriteEffectiveAccessLevel(state.record?.effectiveAccessLevel);
}

function getSnapshotAttachments(
  state: DocumentStoreState,
  currentDoc: DocumentState | null = state.doc,
): DocumentAttachment[] {
  return currentDoc ? getDocumentAttachments(currentDoc) : [];
}

function getSnapshotRows(
  state: DocumentStoreState,
  currentDoc: DocumentState | null = state.doc,
): DocumentRow[] {
  return currentDoc ? listDocumentRows(currentDoc) : [];
}

function resolveCurrentAuthorId(state: DocumentStoreState): string | null {
  return resolveDocumentCreateAuthor(state.runtime)?.signerUserId ?? null;
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
  structuredFieldsOverride?: DocumentSnapshot["structuredFields"],
) {
  const attachments = getSnapshotAttachments(state, currentDoc);
  const rows = getSnapshotRows(state, currentDoc);
  const documentState = readStoredDocumentState(
    currentDoc,
    state.runtime.infra.documentProjectors,
  );
  const text = textOverride ?? documentState.text;
  const structuredFields =
    structuredFieldsOverride ?? documentState.structuredFields;
  const projectedState =
    textOverride === undefined && structuredFieldsOverride === undefined
      ? documentState
      : projectStoredDocumentState(
          {
            documentKind: documentState.documentKind,
            structuredFields,
            text,
            rows: rows.map((row) => ({ id: row.id, fields: row.fields })),
          },
          state.runtime.infra.documentProjectors,
        );

  setDocumentSnapshot(state, {
    attachments,
    attachmentStatusBySlotId: getAttachmentStatuses(state, attachments),
    attachmentStorageKeyBySlotId: getAttachmentStorageKeys(state, attachments),
    canAttach: canAttachFiles(state),
    canWrite: canWriteDocument(state),
    currentAuthorId: resolveCurrentAuthorId(state),
    documentId: state.record?.documentId ?? null,
    documentKind: projectedState.documentKind,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      state.record?.effectiveAccessLevel,
    ),
    fieldValidationIssues: projectedState.fieldValidationIssues,
    ready: true,
    rows,
    structuredFields: projectedState.structuredFields,
    text,
    title: projectedState.title,
    syncing,
  });
}

export function setDocumentSyncing(
  state: DocumentStoreState,
  syncing: boolean,
) {
  setDocumentSnapshot(state, { ...state.snapshot, syncing });
}

export function refreshAttachabilitySnapshot(state: DocumentStoreState) {
  if (!state.snapshot.ready) {
    return;
  }

  setDocumentSnapshot(state, {
    ...state.snapshot,
    canAttach: canAttachFiles(state),
    canWrite: canWriteDocument(state),
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      state.record?.effectiveAccessLevel,
    ),
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
