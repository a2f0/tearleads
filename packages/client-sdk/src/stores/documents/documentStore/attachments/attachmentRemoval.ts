import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import {
  getDocumentAttachments,
  removeDocumentAttachment,
} from "../../../../data/documents/documentContent";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { retryWhileDatabaseBusy } from "../../../../workflows/documents";
import { requestDocumentStoreSync } from "../../registry";
import { ensureDocumentStoreReady } from "../initialization";
import { chainQueuedWrite } from "../localWriteQueue";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "../persistence";
import {
  noteDocumentStoreWrite,
  reportDocumentStoreWriteFailure,
} from "../reportWriteFailure";
import {
  canWriteDocument,
  type DocumentStoreState,
  setReadySnapshot,
} from "../state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import {
  ATTACHMENT_FAILURE_MESSAGE,
  restoreFailedAttachmentMutation,
} from "./attachmentMutationPersistence";
import {
  assignLocalAttachmentSlots,
  removeLocalAttachmentSlot,
} from "./attachmentPersistence";
import {
  type AttachmentWriteGeneration,
  captureAttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
  shouldAbortAttachmentPersistFollowup,
} from "./attachmentWriteGeneration";

function installCommittedAttachmentRemoval(input: {
  currentDoc: NonNullable<DocumentStoreState["doc"]>;
  slotId: string;
  state: DocumentStoreState;
  storageKey: string | undefined;
  syncedAttachment: boolean;
}): void {
  const { slotId, state, storageKey } = input;
  if (!storageKey) return;
  const pending = state.pendingAttachments.find(
    (attachment) =>
      attachment.slotId === slotId && attachment.storageKey === storageKey,
  );
  if (input.syncedAttachment && pending?.upload) {
    assignLocalAttachmentSlots(state, [
      {
        slotId,
        storageKey,
        blobId: pending.upload.blobId,
        contentSha256: pending.contentSha256,
      },
    ]);
  }
  state.pendingAttachments = state.pendingAttachments.filter(
    (attachment) =>
      attachment.slotId !== slotId || attachment.storageKey !== storageKey,
  );
  // The committed removal queued this key. A reset can leave another document
  // uploading from the same copy; a detached marker keeps it until sync.
  void runDocumentOrphanMaintenance(state);
  if (
    input.syncedAttachment ||
    state.attachmentStorageKeyBySlotId[slotId] !== storageKey
  ) {
    return;
  }
  removeLocalAttachmentSlot(state, slotId);
  setReadySnapshot(
    state,
    input.currentDoc,
    state.snapshot.syncing,
    state.snapshot.text,
    state.snapshot.structuredFields,
  );
}

async function commitAttachmentRemoval(input: {
  coveredVersion: string;
  currentDoc: NonNullable<DocumentStoreState["doc"]>;
  generation: NonNullable<
    ReturnType<typeof captureDocumentStoreSyncGeneration>
  >;
  pendingUpdate: ReturnType<typeof createPendingUpdateFields>;
  rollbackSnapshot: Uint8Array;
  slotId: string;
  state: DocumentStoreState;
  storageKey: string | undefined;
  syncedAttachment: boolean;
  writeGeneration: AttachmentWriteGeneration;
}) {
  const { currentDoc, generation, state, storageKey, writeGeneration } = input;
  try {
    // `persistDocument` commits the attachment removal/detach marker, history
    // tail, pending update, and document record in one atomic SQLite
    // transaction, so retrying a busy refusal leaves no partial removal.
    return await retryWhileDatabaseBusy(
      () =>
        persistDocument(
          state,
          currentDoc,
          { snapshotEndVersion: input.coveredVersion },
          {
            ...(storageKey
              ? {
                  attachmentRemoval: {
                    mode: input.syncedAttachment
                      ? ("detach" as const)
                      : ("delete" as const),
                    slotId: input.slotId,
                    storageKey,
                  },
                }
              : {}),
            ...(input.pendingUpdate
              ? { pendingUpdate: input.pendingUpdate }
              : {}),
            preserveSnapshotStructuredFields: true,
            preserveSnapshotText: true,
          },
          generation,
        ),
      {
        isCurrent: () =>
          isAttachmentWriteGenerationCurrent(state, writeGeneration) &&
          isDocumentStoreSyncGenerationCurrent(state, generation),
        onBusy: () => {
          noteDocumentStoreWrite(
            state,
            `${ATTACHMENT_FAILURE_MESSAGE} behind another tab's database transaction`,
          );
        },
      },
    );
  } catch (error) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot: input.rollbackSnapshot,
      state,
    });
    throw error;
  }
}

async function persistRemovedAttachment(
  state: DocumentStoreState,
  slotId: string,
  writeGeneration: AttachmentWriteGeneration,
) {
  if (!isAttachmentWriteGenerationCurrent(state, writeGeneration)) return;
  const currentDoc = state.doc;
  if (!currentDoc) {
    return;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }

  const existingAttachment = getDocumentAttachments(currentDoc).find(
    (attachment) => attachment.slotId === slotId,
  );
  if (!existingAttachment) {
    return;
  }

  // After a reset, a store opened cold holds the slot only as a pending upload.
  const storageKey =
    state.attachmentStorageKeyBySlotId[slotId] ??
    state.pendingAttachments.find((attachment) => attachment.slotId === slotId)
      ?.storageKey;
  if (
    !isAttachmentWriteGenerationCurrent(state, writeGeneration) ||
    state.doc !== currentDoc
  )
    return;
  const rollbackSnapshot = exportFullHistorySnapshot(currentDoc).slice();
  removeDocumentAttachment(currentDoc, slotId);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  const coveredVersion = encodeVersionVector(currentDoc);
  const pendingUpdate = createPendingUpdateFields(attachmentUpdate);
  const syncedAttachment = Boolean(state.record?.documentId);

  // Preserve the optimistic text/structured fields (see persistAttachedFiles):
  // removing an attachment while typing must not regress the editor.
  const persisted = await commitAttachmentRemoval({
    coveredVersion,
    currentDoc,
    generation,
    pendingUpdate,
    rollbackSnapshot,
    slotId,
    state,
    storageKey,
    syncedAttachment,
    writeGeneration,
  });
  if (
    shouldAbortAttachmentPersistFollowup(
      state,
      writeGeneration,
      generation,
      persisted,
    )
  ) {
    // See persistAttachedFiles: only durable same-identity work re-arms sync.
    return;
  }
  installCommittedAttachmentRemoval({
    currentDoc,
    slotId,
    state,
    storageKey,
    syncedAttachment,
  });
  advancePendingBaseVersion(state, currentDoc);
  state.runtime.util.log(
    `Removed attachment ${existingAttachment.name} from document ${state.localId}.`,
  );
  requestDocumentStoreSync(state);
}

export async function removeAttachmentFromDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  slotId: string,
) {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    reportDocumentStoreWriteFailure(state, ATTACHMENT_FAILURE_MESSAGE, error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  const writeGeneration = captureAttachmentWriteGeneration(state);
  if (!writeGeneration) return;
  return chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(async () =>
        persistRemovedAttachment(state, slotId, writeGeneration),
      )
      .catch((error: unknown) => {
        reportDocumentStoreWriteFailure(
          state,
          ATTACHMENT_FAILURE_MESSAGE,
          error,
        );
      }),
  );
}
