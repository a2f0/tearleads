import { encodeVersionVector } from "@tearleads/loro";
import {
  blobByteSourceInputLength,
  createBlobByteSource,
} from "../../../data/blobContracts";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
  removeDocumentAttachment,
} from "../../../data/documents/documentContent";
import {
  deleteLocalDocumentAttachment,
  deletePendingDocumentAttachment,
  type LocalAttachmentRecord,
  markLocalDocumentAttachmentDetached,
  type PendingAttachmentRecord,
  savePendingDocumentAttachment,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import type { DocumentAttachmentUpload } from "../types";
import { ensureDocumentStoreReady } from "./initialization";
import {
  advancePendingBaseVersion,
  deleteLocalAttachmentRecord,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
  queuePendingAttachmentUpload,
  saveLocalAttachmentRecord,
  upsertPendingAttachments,
} from "./persistence";
import {
  canAttachFiles,
  canWriteDocument,
  type DocumentStoreState,
} from "./state";

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
    const byteLength = blobByteSourceInputLength(file.bytes);
    nextPendingAttachments.push({
      byteLength,
      localId,
      mimeType: file.mimeType,
      name: file.name,
      slotId,
      storageKey,
    });
    nextAttachments.push({
      byteLength,
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
  const previousBlobIds = state.attachmentBlobIdBySlotId;
  const localAttachmentRecords = nextPendingAttachments.map(
    (pendingAttachment): LocalAttachmentRecord => ({
      blobId: null,
      byteLength: pendingAttachment.byteLength,
      detachedAt: null,
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

      await state.runtime.infra.blobStore.writeByteSource(
        pendingAttachment.storageKey,
        createBlobByteSource(sourceFile.bytes),
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
          detachedAt: null,
          localId: state.localId,
          mimeType: pendingAttachment.mimeType,
          slotId: pendingAttachment.slotId,
          storageKey: pendingAttachment.storageKey,
        },
      );
    }
  } catch (error) {
    state.attachmentStorageKeyBySlotId = previousStorageKeys;
    state.attachmentBlobIdBySlotId = previousBlobIds;
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
  addDocumentAttachments(currentDoc, nextAttachments);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  // Captured at delta time: the enqueued row proves coverage up to exactly
  // this version, so it is the frontier the persist below may publish.
  const coveredVersion = encodeVersionVector(currentDoc);

  await persistPendingAttachments(state, files, nextPendingAttachments);

  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }
  upsertPendingAttachments(state, nextPendingAttachments);
  // This persist changes attachments, not prose. setReadySnapshot always
  // re-derives attachments from the doc, but preserve the text/structured
  // fields so an attach that overlaps an in-flight keystroke does not republish
  // a stale doc read over the live optimistic editor value.
  await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: coveredVersion },
    {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
  );
  advancePendingBaseVersion(state, currentDoc);
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
    byteLength: blobByteSourceInputLength(file.bytes),
    mimeType: file.mimeType,
    name: file.name,
    slotId,
  };
  addDocumentAttachments(currentDoc, [replacementAttachment]);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  const coveredVersion = encodeVersionVector(currentDoc);

  const storageKey = `${state.localId}-${slotId}-${crypto.randomUUID()}`;
  await state.runtime.infra.blobStore.writeByteSource(
    storageKey,
    createBlobByteSource(file.bytes),
  );
  await saveLocalAttachmentRecord(state, {
    blobId: null,
    byteLength: replacementAttachment.byteLength,
    detachedAt: null,
    localId: state.localId,
    mimeType: replacementAttachment.mimeType,
    slotId,
    storageKey,
  });
  await queuePendingAttachmentUpload(state, replacementAttachment, storageKey);
  // Enqueue only after the blob is written and queued for upload, so we never
  // advertise an attachment in the CRDT whose bytes are missing (matches
  // persistAttachedFiles).
  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }
  // Preserve the optimistic text/structured fields (see persistAttachedFiles):
  // a slot replacement overlapping a keystroke must not regress the editor.
  await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: coveredVersion },
    {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
  );
  advancePendingBaseVersion(state, currentDoc);
  state.runtime.util.log(`Queued attachment ${file.name} for slot ${slotId}.`);
  requestDocumentStoreSync(state);
}

async function deletePendingAttachmentForSlot(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  const pendingAttachment = state.pendingAttachments.find(
    (attachment) =>
      attachment.slotId === slotId && attachment.storageKey === storageKey,
  );
  if (!pendingAttachment) {
    return;
  }

  await deletePendingDocumentAttachment({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });
  state.pendingAttachments = state.pendingAttachments.filter(
    (attachment) => attachment !== pendingAttachment,
  );
}

async function deleteLocalOnlyDetachedAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  await Promise.allSettled([
    deletePendingAttachmentForSlot(state, slotId, storageKey),
    deleteLocalAttachmentRecord(state, slotId, storageKey, null),
    state.runtime.infra.blobStore.deleteBytes(storageKey),
  ]);
}

async function persistRemovedAttachment(
  state: DocumentStoreState,
  slotId: string,
) {
  const currentDoc = state.doc;
  if (!currentDoc) {
    return;
  }

  const existingAttachment = getDocumentAttachments(currentDoc).find(
    (attachment) => attachment.slotId === slotId,
  );
  if (!existingAttachment) {
    return;
  }

  const storageKey = state.attachmentStorageKeyBySlotId[slotId];
  removeDocumentAttachment(currentDoc, slotId);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  const coveredVersion = encodeVersionVector(currentDoc);
  if (attachmentUpdate.byteLength > 0) {
    await enqueuePendingUpdate(state, attachmentUpdate);
  }

  if (storageKey) {
    if (state.record?.documentId) {
      await deletePendingAttachmentForSlot(state, slotId, storageKey);
      // The synced document's local blob row has to outlive the unlink so the
      // next sync can detach its remote binding, so mark it detached rather
      // than deleting it: an unmarked row keeps answering "this blob is still
      // referenced by this document" in the blob browser until the detach
      // reaches the server, which never happens while offline. The slot stays
      // in attachmentStorageKeyBySlotId, which is what syncDetachedAttachments
      // diffs against the document to find the detach it still owes.
      await markLocalDocumentAttachmentDetached({
        execSql: state.runtime.infra.execSql,
        localId: state.localId,
        persistence: state.persistence,
        slotId,
        storageKey,
      });
    } else {
      await deleteLocalOnlyDetachedAttachment(state, slotId, storageKey);
    }
  }

  // Preserve the optimistic text/structured fields (see persistAttachedFiles):
  // removing an attachment while typing must not regress the editor.
  await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: coveredVersion },
    {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
  );
  advancePendingBaseVersion(state, currentDoc);
  state.runtime.util.log(
    `Removed attachment ${existingAttachment.name} from document ${state.localId}.`,
  );
  requestDocumentStoreSync(state);
}

export async function attachFilesToDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  if (files.length === 0) {
    return;
  }

  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    console.error("Failed to attach document files:", error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistAttachedFiles(state, files))
    .catch((error: unknown) => {
      console.error("Failed to attach document files:", error);
    });
  return state.writeChain;
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
    console.error("Failed to remove document attachment:", error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistRemovedAttachment(state, slotId))
    .catch((error: unknown) => {
      console.error("Failed to remove document attachment:", error);
    });
  return state.writeChain;
}

export async function replaceAttachmentInDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    console.error("Failed to replace document attachment:", error);
    return;
  }

  if (!ready || !state.doc || !canWriteDocument(state)) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistSlotAttachmentFile(state, slotId, file))
    .catch((error: unknown) => {
      console.error("Failed to replace document attachment:", error);
    });
  return state.writeChain;
}

export function setAttachmentInDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  slotId: string,
  file: DocumentAttachmentUpload,
) {
  return replaceAttachmentInDocumentStore(state, scheduleSync, slotId, file);
}
