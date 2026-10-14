import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import {
  getDocumentAttachments,
  removeDocumentAttachment,
} from "../../../data/documents/documentContent";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../registry";
import { restoreFailedAttachmentMutation } from "./attachmentMutationPersistence";
import {
  assignLocalAttachmentSlots,
  removeLocalAttachmentSlot,
} from "./attachmentPersistence";
import { ATTACHMENT_FAILURE_MESSAGE } from "./attachments";
import {
  type AttachmentWriteGeneration,
  captureAttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
  shouldAbortAttachmentPersistFollowup,
} from "./attachmentWriteGeneration";
import { ensureDocumentStoreReady } from "./initialization";
import { runDocumentOrphanMaintenance } from "./orphanMaintenance";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import { reportDocumentStoreWriteFailure } from "./reportWriteFailure";
import {
  canWriteDocument,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

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
  let persisted: Awaited<ReturnType<typeof persistDocument>>;
  try {
    persisted = await persistDocument(
      state,
      currentDoc,
      { snapshotEndVersion: coveredVersion },
      {
        ...(storageKey
          ? {
              attachmentRemoval: {
                mode: syncedAttachment
                  ? ("detach" as const)
                  : ("delete" as const),
                slotId,
                storageKey,
              },
            }
          : {}),
        ...(pendingUpdate ? { pendingUpdate } : {}),
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
      },
      generation,
    );
  } catch (error) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot,
      state,
    });
    throw error;
  }
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
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistRemovedAttachment(state, slotId, writeGeneration))
    .catch((error: unknown) => {
      reportDocumentStoreWriteFailure(state, ATTACHMENT_FAILURE_MESSAGE, error);
    });
  return state.writeChain;
}
