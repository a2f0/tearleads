import { createBlobByteSource } from "../../../data/blobContracts";
import type {
  AttachmentStagingRows,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
} from "../../../workflows/documents";
import type { DocumentAttachmentUpload } from "../types";
import { upsertPendingAttachments } from "./attachmentPersistence";
import { type DocumentStoreState, setReadySnapshot } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

interface StagePendingAttachmentsInput {
  files: ReadonlyArray<DocumentAttachmentUpload>;
  generation: DocumentStoreSyncGeneration;
  pendingAttachments: PendingAttachmentRecord[];
  state: DocumentStoreState;
}

function localAttachmentRecords(
  localId: string,
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>,
): LocalAttachmentRecord[] {
  return pendingAttachments.map((pendingAttachment) => ({
    blobId: null,
    byteLength: pendingAttachment.byteLength,
    detachedAt: null,
    localId,
    mimeType: pendingAttachment.mimeType,
    slotId: pendingAttachment.slotId,
    storageKey: pendingAttachment.storageKey,
  }));
}

async function deleteStagedAttachmentBytes(input: {
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
  state: DocumentStoreState;
}) {
  const { state } = input;
  const cleanupResults = await Promise.allSettled(
    input.pendingAttachments.map((attachment) =>
      state.runtime.infra.blobStore.deleteBytes(attachment.storageKey),
    ),
  );
  const failedCleanupCount = cleanupResults.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCleanupCount > 0) {
    state.runtime.util.log(
      `Documents: failed to roll back ${failedCleanupCount} staged attachment operation${failedCleanupCount === 1 ? "" : "s"}.`,
    );
  }
}

export async function deleteUnreferencedStagedAttachmentBytes(input: {
  generation: DocumentStoreSyncGeneration;
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
  state: DocumentStoreState;
}): Promise<void> {
  let durableStorageKeys: Set<string>;
  try {
    const durableAttachments =
      await input.state.persistence.listLocalAttachments(
        input.generation.execSql,
        input.state.localId,
      );
    durableStorageKeys = new Set(
      durableAttachments.map(({ storageKey }) => storageKey),
    );
  } catch {
    // A failed probe cannot prove that the atomic mutation rolled back. Keep
    // the bytes: orphan maintenance can reclaim them once storage is readable.
    return;
  }
  await deleteStagedAttachmentBytes({
    pendingAttachments: input.pendingAttachments.filter(
      ({ storageKey }) => !durableStorageKeys.has(storageKey),
    ),
    state: input.state,
  });
}

async function writePendingAttachmentBytes(
  input: StagePendingAttachmentsInput,
): Promise<void> {
  for (const [index, pendingAttachment] of input.pendingAttachments.entries()) {
    const sourceFile = input.files[index];
    if (!sourceFile) continue;
    await input.state.runtime.infra.blobStore.writeByteSource(
      pendingAttachment.storageKey,
      createBlobByteSource(sourceFile.bytes),
    );
  }
}

export function installPendingAttachmentRows(input: {
  localAttachments: ReadonlyArray<LocalAttachmentRecord>;
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
  state: DocumentStoreState;
}): void {
  const { localAttachments, pendingAttachments, state } = input;
  state.attachmentBlobIdBySlotId = {
    ...state.attachmentBlobIdBySlotId,
    ...Object.fromEntries(
      localAttachments.map((attachment) => [
        attachment.slotId,
        attachment.blobId,
      ]),
    ),
  };
  state.attachmentStorageKeyBySlotId = {
    ...state.attachmentStorageKeyBySlotId,
    ...Object.fromEntries(
      localAttachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    ),
  };
  upsertPendingAttachments(state, pendingAttachments);
  if (state.doc) {
    setReadySnapshot(
      state,
      state.doc,
      state.snapshot.syncing,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
  }
}

export async function stagePendingAttachments(
  input: StagePendingAttachmentsInput,
): Promise<AttachmentStagingRows | null> {
  const { pendingAttachments, state } = input;
  const localAttachments = localAttachmentRecords(
    state.localId,
    pendingAttachments,
  );

  try {
    await writePendingAttachmentBytes(input);

    if (!isDocumentStoreSyncGenerationCurrent(state, input.generation)) {
      await deleteStagedAttachmentBytes({ pendingAttachments, state });
      return null;
    }
    return { localAttachments, pendingAttachments };
  } catch (error) {
    await deleteStagedAttachmentBytes({ pendingAttachments, state });
    throw error;
  }
}
