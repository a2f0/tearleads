import type { createDocument } from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
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
import type { DocumentSyncPullContinuation } from "../../../data/documents/shared/sync/syncPagination";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/types";
import {
  canWriteEffectiveAccessLevel,
  normalizeEffectiveAccessLevel,
} from "../../../data/keying/accessLevel";
import type { DomainScope } from "../../../data/shared/domainScope";
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
  DocumentSnapshot,
  DocumentStoreOpenOptions,
  DocumentsRuntime,
} from "../types";
import {
  getAttachmentStatuses,
  getAttachmentStorageKeys,
} from "./attachments/attachmentSnapshot";
import { sameValidationIssues, shallowEqualRecord } from "./snapshotEquality";
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
        pruneCoveredLocalState: boolean;
        snapshot: string;
      }
    | undefined;
  historyUpdateOrigin?: "local" | "remote" | undefined;
  historyUpdates?: readonly string[] | undefined;
  pendingUpdate?: Omit<PendingUpdateInsert, "localId"> | undefined;
  pendingBaseVersionOverride?: string | null | undefined;
  preserveSnapshotStructuredFields?: boolean | undefined;
  preserveSnapshotText?: boolean | undefined;
  stillCurrent?: (() => boolean) | undefined;
}
export interface DocumentSyncAttempt {
  consumedPullContinuation: DocumentSyncPullContinuation | null;
  outgoingUpdateCount: number;
  requestRecord: DocumentRecord;
  synced: SyncRemoteDocumentResult;
  /** `writerProjectionGeneration` when the request left; gates the install. */
  writerProjectionGeneration: number;
}
export interface DocumentStorePersistenceEffects {
  emitPersistedDocument: (
    domainScope: DomainScope,
    persistedDocument: DocumentSummary,
    placementChanged?: boolean | undefined,
  ) => void;
  registerDocumentIdentity: (
    domainScope: DomainScope,
    localId: string,
    documentId: string | null,
  ) => void;
}
export interface DocumentStoreState {
  attachmentBlobIdBySlotId: Record<string, string | null>;
  /** Plaintext digest of the held bytes per slot; see `getAttachmentStatuses`. */
  attachmentContentSha256BySlotId: Record<string, string>;
  attachmentStorageKeyBySlotId: Record<string, string>;
  /** Creation's birth rides the first attach; see `deferredInitialUpdate.ts`. */
  deferInitialUpdate?: boolean;
  doc: DocumentState | null;
  effects: DocumentStorePersistenceEffects;
  initialDocumentId: string | null;
  /** Fields and rows a created record starts with; see `initialContent.ts`. */
  initialContent?: Pick<
    DocumentStoreOpenOptions,
    "initialRows" | "initialStructuredFields"
  >;
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
  /** Local writes called or chained but unsettled; zero means all in SQLite. */
  queuedWrites: number;
  persistence: DocumentsPersistence;
  /**
   * Durable continuation for a bounded remote pull, mirrored from the document
   * record so the live lane can advance it without re-reading SQLite.
   */
  pullContinuation: DocumentSyncPullContinuation | null;
  record: DocumentRecord | null;
  /** Served bindings hydration refused for a held copy; see `hydrate.ts`. */
  rejectedServedAttachmentBindings: Set<string>;
  /**
   * Consecutive completed sync passes that re-keyed conflicted pending updates
   * without settling anything. Bounds the rekey-driven self re-arm so a server
   * that keeps conflicting fresh ids cannot drive a network-speed loop; see
   * shouldReArmAfterOutgoingSettlement.
   */
  rekeyOnlyPassCount: number;
  resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
  /** Latest remote-update sequence durably applied by a completed probe. */
  remoteUpdateCompletedSignalSeq: number;
  /** A cancelled remote-only owner blocks late responses until fresh work. */
  remoteSyncBlocked: boolean;
  scheduleStartupRemoteSync: boolean;
  startupProbeDeferredAttempt: number | null;
  remoteUpdatePending: boolean;
  /** Sequence used to keep an older pass from clearing a newer remote event. */
  remoteUpdateSignalSeq: number;
  runtime: DocumentsRuntime;
  snapshot: DocumentSnapshot;
  syncLane: DocumentSyncLane | null;
  /** Parked behind another member's ancestor repair; a path hint re-runs. */
  awaitingAncestorRepair: boolean;
  writeChain: Promise<void>;
  writerProjection: DocumentWriterProjectionResponse | null;
  /**
   * Bumped whenever a realtime hint drops `writerProjection`; an operation that
   * fetched or was handed a projection installs it only if this is unchanged
   * since it started, so a pre-hint answer never lands after the hint.
   */
  writerProjectionGeneration: number;
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

export function createDocumentStoreState(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence,
  effects: DocumentStorePersistenceEffects,
  initialDocumentId: string | null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
  scheduleStartupRemoteSync = true,
): DocumentStoreState {
  return {
    attachmentBlobIdBySlotId: {},
    attachmentContentSha256BySlotId: {},
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
    queuedWrites: 0,
    pullContinuation: null,
    record: null,
    rejectedServedAttachmentBindings: new Set(),
    rekeyOnlyPassCount: 0,
    resolveProjectionUserKey:
      createDocumentProjectionUserKeyResolver(initialRuntime),
    remoteUpdateCompletedSignalSeq: 0,
    remoteSyncBlocked: !scheduleStartupRemoteSync,
    scheduleStartupRemoteSync,
    startupProbeDeferredAttempt: null,
    awaitingAncestorRepair: false,
    remoteUpdatePending: false,
    remoteUpdateSignalSeq: 0,
    runtime: initialRuntime,
    snapshot: { ...EMPTY_DOCUMENT_SNAPSHOT },
    syncLane: null,
    writeChain: Promise.resolve(),
    writerProjection: null,
    writerProjectionGeneration: 0,
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
  state.deferInitialUpdate = false;
  state.doc = null;
  state.localWriteGeneration += 1;
  state.record = null;
  state.pendingAttachments = [];
  state.pendingBaseVersion = null;
  state.pendingLocalWrites = 0;
  state.pullContinuation = null;
  state.attachmentBlobIdBySlotId = {};
  state.attachmentContentSha256BySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  state.locallyAcceptedUpdateIds = new Set();
  state.rejectedServedAttachmentBindings = new Set();
  state.remoteUpdateCompletedSignalSeq = 0;
  state.remoteSyncBlocked = !state.scheduleStartupRemoteSync;
  state.startupProbeDeferredAttempt = null;
  state.awaitingAncestorRepair = false;
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
    attachmentStatusBySlotId: getAttachmentStatuses({
      attachments,
      contentSha256BySlotId: state.attachmentContentSha256BySlotId,
      pendingSlotIds: new Set(
        state.pendingAttachments.map((attachment) => attachment.slotId),
      ),
    }),
    attachmentStorageKeyBySlotId: getAttachmentStorageKeys(
      state.attachmentStorageKeyBySlotId,
      attachments,
    ),
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
  return () => void state.listeners.delete(listener);
}

/**
 * Counts `write` in `queuedWrites` until it settles. Counted synchronously, so
 * a write started while a removal runs is visible to its commit guard.
 */
export function countQueuedWrite<T>(
  state: DocumentStoreState,
  write: Promise<T>,
): Promise<T> {
  state.queuedWrites += 1;
  const settle = () => {
    state.queuedWrites -= 1;
  };
  void write.then(settle, settle);
  return write;
}

/** Installs `link` as the store's write chain, counted until it settles. */
export function chainQueuedWrite(
  state: DocumentStoreState,
  link: Promise<void>,
): Promise<void> {
  state.writeChain = countQueuedWrite(state, link);
  return state.writeChain;
}
