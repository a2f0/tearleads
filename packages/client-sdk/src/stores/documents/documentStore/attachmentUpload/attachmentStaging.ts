import { createBlobByteSource } from "../../../../workflows/blobs";
import {
  type AttachmentStagingRows,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  runSerializedDocumentBlobMutation,
  runSerializedSqlMutation,
} from "../../../../workflows/documents";
import type { DocumentAttachmentUpload } from "../../types";
import {
  assignLocalAttachmentSlots,
  upsertPendingAttachments,
} from "../attachments/attachmentPersistence";
import { type DocumentStoreState, setReadySnapshot } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";

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
    contentSha256: pendingAttachment.contentSha256,
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

/**
 * Roll back staged bytes that no committed row references. Like orphan
 * reclaim, check every held and pending reference under the key's lock: an
 * overlapping reset can leave a committed key referenced only by an upload.
 */
export async function deleteUnreferencedStagedAttachmentBytes(input: {
  generation: DocumentStoreSyncGeneration;
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
  state: DocumentStoreState;
}): Promise<void> {
  const { execSql } = input.generation;
  const { state } = input;
  let failedCleanupCount = 0;
  for (const { storageKey } of input.pendingAttachments) {
    try {
      await runSerializedDocumentBlobMutation(execSql, storageKey, async () => {
        const referenced = await runSerializedSqlMutation(
          execSql,
          (lockedExecSql) =>
            state.persistence.orphanBlobs.isReferenced(
              lockedExecSql,
              storageKey,
            ),
        );
        if (!referenced)
          await state.runtime.infra.blobStore.deleteBytes(storageKey);
      });
    } catch {
      // A failed probe cannot prove that the atomic mutation rolled back, so
      // the bytes stay; a failed delete leaves them for a later sweep.
      failedCleanupCount += 1;
    }
  }
  if (failedCleanupCount > 0)
    state.runtime.util.log(
      `Documents: failed to roll back ${failedCleanupCount} staged attachment operation${failedCleanupCount === 1 ? "" : "s"}.`,
    );
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
  assignLocalAttachmentSlots(state, localAttachments);
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
