import { encodeVersionVector, exportUpdatesSince } from "@tearleads/loro";
import {
  addDocumentAttachments,
  type DocumentAttachment,
} from "../../../data/documents/documentContent";
import {
  deleteLocalDocumentAttachment,
  deletePendingDocumentAttachment,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  savePendingDocumentAttachment,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import type { DocumentAttachmentUpload } from "../types";
import {
  enqueuePendingUpdate,
  persistDocument,
  queuePendingAttachmentUpload,
  saveLocalAttachmentRecord,
  upsertPendingAttachments,
} from "./persistence";
import { canAttachFiles, type DocumentStoreState } from "./state";

function buildPendingAttachments(
  localId: string,
  files: ReadonlyArray<DocumentAttachmentUpload>,
): {
  nextAttachments: DocumentAttachment[];
  nextPendingAttachments: PendingAttachmentRecord[];
} {
  const nextPendingAttachments: PendingAttachmentRecord[] = [];
  const nextAttachments: DocumentAttachment[] = [];

  for (const file of files) {
    const slotId = crypto.randomUUID();
    const storageKey = `${localId}-${slotId}`;
    nextPendingAttachments.push({
      byteLength: file.bytes.byteLength,
      localId,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
      storageKey,
    });
    nextAttachments.push({
      byteLength: file.bytes.byteLength,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
    });
  }

  return { nextAttachments, nextPendingAttachments };
}

async function persistPendingAttachments(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
  nextPendingAttachments: PendingAttachmentRecord[],
) {
  const previousStorageKeys = state.attachmentStorageKeyBySlotId;
  const localAttachmentRecords = nextPendingAttachments.map(
    (pendingAttachment): LocalAttachmentRecord => ({
      blobId: null,
      byteLength: pendingAttachment.byteLength,
      localId: state.localId,
      mimeType: pendingAttachment.mimeType,
      slotId: pendingAttachment.slotId,
      storageKey: pendingAttachment.storageKey,
    }),
  );

  try {
    for (const [index, pendingAttachment] of nextPendingAttachments.entries()) {
      const sourceFile = files[index];
      if (!sourceFile) {
        continue;
      }

      await state.runtime.infra.blobStore.writeBytes(
        pendingAttachment.storageKey,
        sourceFile.bytes,
      );
      await savePendingDocumentAttachment({
        attachment: pendingAttachment,
        execSql: state.runtime.infra.execSql,
        persistence: state.persistence,
      });
      await saveLocalAttachmentRecord(
        state,
        localAttachmentRecords[index] ?? {
          blobId: null,
          byteLength: pendingAttachment.byteLength,
          localId: state.localId,
          mimeType: pendingAttachment.mimeType,
          slotId: pendingAttachment.slotId,
          storageKey: pendingAttachment.storageKey,
        },
      );
    }
  } catch (error) {
    state.attachmentStorageKeyBySlotId = previousStorageKeys;
    await rollbackPendingAttachmentPersistence(
      state,
      nextPendingAttachments,
      localAttachmentRecords,
    );
    throw error;
  }
}

async function rollbackPendingAttachmentPersistence(
  state: DocumentStoreState,
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>,
  localAttachments: ReadonlyArray<LocalAttachmentRecord>,
) {
  const cleanupResults = await Promise.allSettled([
    ...pendingAttachments.map((attachment) =>
      deletePendingDocumentAttachment({
        execSql: state.runtime.infra.execSql,
        localId: state.localId,
        persistence: state.persistence,
        slotId: attachment.slotId,
        storageKey: attachment.storageKey,
      }),
    ),
    ...localAttachments.map((attachment) =>
      deleteLocalDocumentAttachment({
        execSql: state.runtime.infra.execSql,
        localId: state.localId,
        persistence: state.persistence,
        slotId: attachment.slotId,
        storageKey: attachment.storageKey,
      }),
    ),
    ...pendingAttachments.map((attachment) =>
      state.runtime.infra.blobStore.deleteBytes(attachment.storageKey),
    ),
  ]);
  const failedCleanupCount = cleanupResults.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCleanupCount > 0) {
    state.runtime.util.log(
      `Documents: failed to roll back ${failedCleanupCount} staged attachment operation${failedCleanupCount === 1 ? "" : "s"}.`,
    );
  }
}

function logAttachedFiles(state: DocumentStoreState, count: number) {
  state.runtime.util.log(
    state.runtime.state.online && state.runtime.auth.isAuthenticated
      ? `Attached ${count} file${count === 1 ? "" : "s"} to document ${state.localId}.`
      : `Stored ${count} attachment${count === 1 ? "" : "s"} locally for document ${state.localId}.`,
  );
}

async function persistAttachedFiles(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.util.log(
      "Documents: attachments require a local key package.",
    );
    return;
  }

  const { nextAttachments, nextPendingAttachments } = buildPendingAttachments(
    state.localId,
    files,
  );
  const previousVersion = encodeVersionVector(currentDoc);
  addDocumentAttachments(currentDoc, nextAttachments);
  const attachmentUpdate = exportUpdatesSince(currentDoc, previousVersion);

  await persistPendingAttachments(state, files, nextPendingAttachments);

  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }
  upsertPendingAttachments(state, nextPendingAttachments);
  await persistDocument(state, currentDoc);
  logAttachedFiles(state, files.length);
  requestDocumentStoreSync(state);
}

async function persistSlotAttachmentFile(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;

  if (!currentDoc || !canAttachFiles(state) || !encapsulationKeyPair) {
    state.runtime.util.log(
      "Documents: slot attachments require a local key package.",
    );
    return;
  }

  const replacementAttachment: DocumentAttachment = {
    byteLength: file.bytes.byteLength,
    mimeType: file.mimeType,
    name: file.name,
    slotId,
  };
  const previousVersion = encodeVersionVector(currentDoc);
  addDocumentAttachments(currentDoc, [replacementAttachment]);
  const attachmentUpdate = exportUpdatesSince(currentDoc, previousVersion);
  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }

  const storageKey = `${state.localId}-${slotId}-${crypto.randomUUID()}`;
  await state.runtime.infra.blobStore.writeBytes(storageKey, file.bytes);
  await saveLocalAttachmentRecord(state, {
    blobId: null,
    byteLength: replacementAttachment.byteLength,
    localId: state.localId,
    mimeType: replacementAttachment.mimeType,
    slotId,
    storageKey,
  });
  await queuePendingAttachmentUpload(state, replacementAttachment, storageKey);
  await persistDocument(state, currentDoc);
  state.runtime.util.log(`Queued attachment ${file.name} for slot ${slotId}.`);
  requestDocumentStoreSync(state);
}

export function attachFilesToDocumentStore(
  state: DocumentStoreState,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  if (files.length === 0 || !state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistAttachedFiles(state, files))
    .catch((error: unknown) => {
      console.error("Failed to attach document files:", error);
    });
}

export function replaceAttachmentInDocumentStore(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  if (!state.doc) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistSlotAttachmentFile(state, slotId, file))
    .catch((error: unknown) => {
      console.error("Failed to replace document attachment:", error);
    });
}

export function setAttachmentInDocumentStore(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  replaceAttachmentInDocumentStore(state, slotId, file);
}
