import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
} from "@tearleads/loro";
import { normalizeEffectiveAccessLevel } from "../../../data/accessLevel";
import type { DocumentSummary } from "../../../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import type { DocumentAttachment } from "../../../data/documents/documentContent";
import {
  type DocumentProjectorRegistry,
  projectStoredDocumentState,
} from "../../../data/documents/documentKinds";

import {
  DOCUMENT_HISTORY_COMPACTION_MAX_BYTES,
  DOCUMENT_HISTORY_COMPACTION_MAX_ROWS,
  type DocumentRecord,
  deleteLocalDocumentAttachment,
  deletePendingDocumentAttachment,
  enqueuePendingDocumentUpdate,
  type LocalAttachmentRecord,
  listPendingDocumentUpdates,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  persistDocumentState,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
} from "../../../workflows/documents";
import { withLocalAttachmentDetachState } from "./attachmentDetachState";
import {
  type DocumentState,
  type DocumentStoreState,
  type PersistedDocumentRecord,
  type SaveDocumentRecordOptions,
  setReadySnapshot,
} from "./state";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

function documentSummaryFromRecord(
  record: DocumentRecord,
  updatedAt: string,
  documentProjectors: DocumentProjectorRegistry,
): DocumentSummary {
  return {
    accessStateHash: record.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      record.effectiveAccessLevel,
    ),
    id: record.id,
    containerId: record.containerId,
    documentKind: record.documentKind ?? DEFAULT_DOCUMENT_KIND,
    documentId: record.documentId,
    title:
      record.title ??
      projectStoredDocumentState(
        {
          documentKind: record.documentKind ?? DEFAULT_DOCUMENT_KIND,
          structuredFields: {},
          text: record.text,
        },
        documentProjectors,
      ).title,
    updatedAt,
  };
}

export function saveDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch?: Partial<DocumentRecord>,
  options?: SaveDocumentRecordOptions,
): Promise<PersistedDocumentRecord>;
export function saveDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord>,
  options: SaveDocumentRecordOptions,
  expectedGeneration: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null>;
export async function saveDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null> {
  const previousDocumentId = state.record?.documentId ?? null;
  const pendingBaseVersion =
    options.pendingBaseVersionOverride === undefined
      ? state.pendingBaseVersion
      : options.pendingBaseVersionOverride;
  const persistenceInput = {
    acceptedPendingUpdateIds: options.acceptedPendingUpdateIds,
    containerId: state.runtime.state.containerId,
    currentDoc,
    currentRecord: state.record,
    documentProjectors: state.runtime.infra.documentProjectors,
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    // Persist the durable outgoing-delta marker with every snapshot write so a
    // restart restores it (see initializeDocumentStore). A device-first
    // deferRemoteSync write leaves it BEHIND the snapshot version on purpose;
    // capturing state.pendingBaseVersion here is what lets the next edit
    // re-derive that deferred op after a restart instead of dropping it.
    patch: { ...patch, pendingBaseVersion },
    persistence: state.persistence,
  };
  const persistedDocumentState = expectedGeneration
    ? await persistDocumentState({
        ...persistenceInput,
        // persistDocumentState rechecks after its own pre-save awaits and then
        // immediately claims the executor mutation queue. A reset before that
        // point aborts; a reset afterward cannot let replacement writes overtake.
        canStartDurableMutation: () =>
          isSyncGenerationCurrent(state, expectedGeneration),
      })
    : await persistDocumentState(persistenceInput);
  if (!persistedDocumentState) {
    return null;
  }
  const { record: nextRecord, updatedAt } = persistedDocumentState;
  if (
    expectedGeneration &&
    !isSyncGenerationCurrent(state, expectedGeneration)
  ) {
    return null;
  }

  state.record = persistedDocumentState.record;
  if (previousDocumentId !== nextRecord.documentId) {
    state.effects.registerDocumentIdentity(
      state.runtime.state.domainScope,
      nextRecord.id,
      nextRecord.documentId,
    );
  }
  state.effects.emitPersistedDocument(
    state.runtime.state.domainScope,
    documentSummaryFromRecord(
      nextRecord,
      updatedAt,
      state.runtime.infra.documentProjectors,
    ),
  );
  return {
    record: nextRecord,
    updatedAt,
  };
}

export function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch?: Partial<DocumentRecord>,
  options?: SaveDocumentRecordOptions,
): Promise<PersistedDocumentRecord>;
export function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord>,
  options: SaveDocumentRecordOptions,
  expectedGeneration: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null>;
export async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null> {
  const persistedRecord = expectedGeneration
    ? await saveDocumentRecord(
        state,
        currentDoc,
        patch,
        options,
        expectedGeneration,
      )
    : await saveDocumentRecord(state, currentDoc, patch, options);
  if (!persistedRecord) return null;
  if (expectedGeneration && !isSyncGenerationCurrent(state, expectedGeneration))
    return null;

  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    options.preserveSnapshotText
      ? state.snapshot.text
      : persistedRecord.record.text,
    options.preserveSnapshotStructuredFields
      ? state.snapshot.structuredFields
      : undefined,
  );
  // Compaction never fails the persist that triggered it: durable history is
  // a resilience feature, and a failed export (e.g. a legacy shallow-restored
  // document) simply keeps the tail growing until a rebuild re-enables it.
  try {
    await maybeCompactDocumentHistory(state, currentDoc);
  } catch (error) {
    state.runtime.util.log(
      `Documents: history compaction skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return persistedRecord;
}

/**
 * Refresh the durable full-history checkpoint when the tail has grown past
 * the compaction thresholds, or seed the first checkpoint as soon as the
 * document can export full history (a freshly created or rebuilt document is
 * cheap to export; waiting for the threshold would leave restarts without
 * history until then). The snapshot comes from the LIVE document, which has
 * every tail update imported, so clearing the tail loses nothing.
 */
async function maybeCompactDocumentHistory(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): Promise<void> {
  const { persistence } = state;
  if (
    !persistence.listHistoryTailIds ||
    !persistence.readHistoryTailSize ||
    !persistence.replaceHistoryCheckpoint
  ) {
    return;
  }
  // Bind this compaction to the store context it started under: a store
  // reset or runtime swap mid-compaction must not let the OLD document's
  // checkpoint overwrite the replacement generation's history (or land in a
  // newly selected database).
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }
  const execSql = state.runtime.infra.execSql;
  const tail = await persistence.readHistoryTailSize(execSql, state.localId);
  if (
    tail.hasCheckpoint &&
    tail.rowCount < DOCUMENT_HISTORY_COMPACTION_MAX_ROWS &&
    tail.byteLength < DOCUMENT_HISTORY_COMPACTION_MAX_BYTES
  ) {
    return;
  }

  // Capture the covered rows BEFORE exporting: every append path writes its
  // tail row after the ops are already in the live document, so these rows
  // are provably in the export, while a concurrent append lands after the
  // capture and survives the delete for the next compaction.
  const coveredTailIds = await persistence.listHistoryTailIds(
    execSql,
    state.localId,
  );
  let snapshot: Uint8Array;
  try {
    snapshot = exportFullHistorySnapshot(currentDoc);
  } catch {
    // Legacy shallow-restored document: full history is not exportable until
    // a history recovery or rotation rebuild installs a full document.
    return;
  }
  if (!isSyncGenerationCurrent(state, generation)) {
    return;
  }
  await persistence.replaceHistoryCheckpoint(execSql, {
    coveredTailIds,
    localId: state.localId,
    snapshot: bytesToBase64(snapshot),
  });
}

export async function listPendingUpdates(
  state: DocumentStoreState,
): Promise<PendingUpdateRecord[]> {
  return listPendingDocumentUpdates({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
}

/**
 * Export the outgoing delta for the current edit. The base is `pendingBaseVersion`
 * (the version through which ops are already durably enqueued or synced), NOT the
 * live doc version, so any delta orphaned by a prior failed enqueue is folded back
 * in here. In the success path the marker equals the pre-edit version, so this is
 * identical to exporting "since the last edit".
 *
 * Initialization sets `pendingBaseVersion` whenever it sets `doc`, and every
 * caller checks `doc` first, so the marker is non-null here. Assert that rather
 * than falling back to the live version: callers invoke this AFTER mutating the
 * doc, so a live-version fallback would export an empty (post-mutation) delta and
 * silently drop the edit.
 */
export function pendingDeltaSinceBase(
  state: DocumentStoreState,
  doc: DocumentState,
): Uint8Array {
  if (state.pendingBaseVersion === null) {
    throw new Error(
      "pendingDeltaSinceBase requires an initialized pendingBaseVersion",
    );
  }
  return exportUpdatesSince(doc, state.pendingBaseVersion);
}

/**
 * Advance the durable marker to the doc's current version. Call this ONLY after
 * an edit's delta has been durably enqueued and persisted, or after remote
 * updates have been imported (those ops are already on the server).
 */
export function advancePendingBaseVersion(
  state: DocumentStoreState,
  doc: DocumentState,
): void {
  state.pendingBaseVersion = encodeVersionVector(doc);
}

export async function enqueuePendingUpdate(
  state: DocumentStoreState,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await enqueuePendingDocumentUpdate({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
    update,
  });
}

export async function deletePendingAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  await deletePendingDocumentAttachment({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });
}

export async function deleteLocalAttachmentRecord(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
  currentDoc: DocumentState | null = state.doc,
) {
  await deleteLocalDocumentAttachment({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });

  if (state.attachmentStorageKeyBySlotId[slotId] === storageKey) {
    const { [slotId]: _removedStorageKey, ...nextStorageKeys } =
      state.attachmentStorageKeyBySlotId;
    const { [slotId]: _removedBlobId, ...nextBlobIds } =
      state.attachmentBlobIdBySlotId;
    state.attachmentStorageKeyBySlotId = nextStorageKeys;
    state.attachmentBlobIdBySlotId = nextBlobIds;
  }

  if (currentDoc && currentDoc === state.doc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
  }
}

export async function saveLocalAttachmentRecord(
  state: DocumentStoreState,
  attachment: LocalAttachmentRecord,
  currentDoc: DocumentState | null = state.doc,
) {
  await saveLocalAttachmentRecords(state, [attachment], currentDoc);
}

export async function saveLocalAttachmentRecords(
  state: DocumentStoreState,
  attachments: ReadonlyArray<LocalAttachmentRecord>,
  currentDoc: DocumentState | null = state.doc,
  expectedGeneration?: DocumentStoreSyncGeneration,
) {
  if (attachments.length === 0) {
    return;
  }

  await saveLocalDocumentAttachments({
    attachments: withLocalAttachmentDetachState(attachments, currentDoc),
    execSql: state.runtime.infra.execSql,
    persistence: state.persistence,
  });
  if (
    expectedGeneration &&
    !isSyncGenerationCurrent(state, expectedGeneration)
  ) {
    return;
  }

  state.attachmentBlobIdBySlotId = {
    ...state.attachmentBlobIdBySlotId,
    ...Object.fromEntries(
      attachments.map((attachment) => [attachment.slotId, attachment.blobId]),
    ),
  };
  state.attachmentStorageKeyBySlotId = {
    ...state.attachmentStorageKeyBySlotId,
    ...Object.fromEntries(
      attachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    ),
  };

  if (currentDoc && currentDoc === state.doc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
  }
}

export function upsertPendingAttachments(
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

/**
 * Persist a pending attachment's upload-resume identity (blob id, content key,
 * IV, and — once staged — the multipart stage id/part size) so a later attempt
 * reuses it instead of orphaning the stage. The caller mutates the record's
 * `upload` field in place (keeping the same object reference the sync loop tracks
 * by identity), so this only writes through to durable storage.
 */
export async function savePendingAttachmentUpload(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
): Promise<void> {
  await savePendingDocumentAttachment({
    attachment: pendingAttachment,
    execSql: state.runtime.infra.execSql,
    persistence: state.persistence,
  });
}

export async function queuePendingAttachmentUpload(
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
  await savePendingDocumentAttachment({
    attachment: pendingAttachment,
    execSql: state.runtime.infra.execSql,
    persistence: state.persistence,
  });
  upsertPendingAttachments(state, [pendingAttachment]);
  return pendingAttachment;
}
