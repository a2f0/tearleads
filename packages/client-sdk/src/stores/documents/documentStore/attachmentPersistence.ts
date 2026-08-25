import {
  deleteLocalDocumentAttachment,
  deletePendingDocumentAttachment,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
} from "../../../workflows/documents";
import { withLocalAttachmentDetachState } from "./attachmentDetachState";
import { withGenerationGuardedMutation } from "./persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

export async function deletePendingAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
  expectedGeneration?: DocumentStoreSyncGeneration,
) {
  // After a REFUSED discard the reset store keeps its rows, and a stale pass
  // racing that reset must not delete state the refusal deliberately
  // preserved.
  await withGenerationGuardedMutation(state, expectedGeneration, (execSql) =>
    deletePendingDocumentAttachment({
      execSql,
      localId: state.localId,
      persistence: state.persistence,
      slotId,
      storageKey,
    }),
  );
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
  expectedGeneration?: DocumentStoreSyncGeneration,
) {
  await saveLocalAttachmentRecords(
    state,
    [attachment],
    currentDoc,
    expectedGeneration,
  );
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

  // These rows are upserts, and a stale writer racing a teardown must never
  // re-insert what the teardown just removed.
  const saved = await withGenerationGuardedMutation(
    state,
    expectedGeneration,
    (execSql) =>
      saveLocalDocumentAttachments({
        attachments: withLocalAttachmentDetachState(attachments, currentDoc),
        execSql,
        persistence: state.persistence,
      }),
  );
  if (
    !saved ||
    (expectedGeneration && !isSyncGenerationCurrent(state, expectedGeneration))
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
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<void> {
  // This row is an upsert, and a stale resume racing a teardown must never
  // re-insert the pending row the teardown just removed.
  await withGenerationGuardedMutation(state, expectedGeneration, (execSql) =>
    savePendingDocumentAttachment({
      attachment: pendingAttachment,
      execSql,
      persistence: state.persistence,
    }),
  );
}
