import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { blobByteSourceInputLength } from "../../../data/blobContracts";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
  removeDocumentAttachment,
} from "../../../data/documents/documentContent";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import type { DocumentAttachmentUpload } from "../types";
import {
  persistStagedAttachmentMutation,
  restoreFailedAttachmentMutation,
} from "./attachmentMutationPersistence";
import {
  deleteUnreferencedStagedAttachmentBytes,
  installPendingAttachmentRows,
  stagePendingAttachments,
} from "./attachmentStaging";
import {
  type AttachmentWriteGeneration,
  captureAttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
  shouldAbortAttachmentPersistFollowup,
} from "./attachmentWriteGeneration";
import { ensureDocumentStoreReady } from "./initialization";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import {
  canAttachFiles,
  canWriteDocument,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

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
  writeGeneration: AttachmentWriteGeneration,
) {
  if (!isAttachmentWriteGenerationCurrent(state, writeGeneration)) return;
  const currentDoc = state.doc;

  if (!currentDoc || !canAttachFiles(state)) {
    state.runtime.util.log(
      "Documents: attachments require a local key package.",
    );
    return;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }

  const { nextAttachments, nextPendingAttachments } = buildPendingAttachments(
    state.localId,
    files,
  );
  const rollbackSnapshot = exportFullHistorySnapshot(currentDoc).slice();
  addDocumentAttachments(currentDoc, nextAttachments);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  // Captured at delta time: the enqueued row proves coverage up to exactly
  // this version, so it is the frontier the persist below may publish.
  const coveredVersion = encodeVersionVector(currentDoc);

  let staged: Awaited<ReturnType<typeof stagePendingAttachments>>;
  try {
    staged = await stagePendingAttachments({
      files,
      generation,
      pendingAttachments: nextPendingAttachments,
      state,
    });
  } catch (error) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot,
      state,
    });
    throw error;
  }
  if (!staged) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot,
      state,
    });
    return;
  }
  // This persist changes attachments, not prose. setReadySnapshot always
  // re-derives attachments from the doc, but preserve the text/structured
  // fields so an attach that overlaps an in-flight keystroke does not republish
  // a stale doc read over the live optimistic editor value.
  const persisted = await persistStagedAttachmentMutation({
    attachmentUpdate,
    coveredVersion,
    currentDoc,
    generation,
    rollbackSnapshot,
    staged,
    state,
  });
  if (
    shouldAbortAttachmentPersistFollowup(
      state,
      writeGeneration,
      generation,
      persisted,
    )
  ) {
    await deleteUnreferencedStagedAttachmentBytes({
      generation,
      pendingAttachments: staged.pendingAttachments,
      state,
    });
    return;
  }
  installPendingAttachmentRows({ ...staged, state });
  advancePendingBaseVersion(state, currentDoc);
  logAttachedFiles(state, files.length);
  requestDocumentStoreSync(state);
}

async function persistSlotAttachmentFile(
  state: DocumentStoreState,
  slotId: string,
  file: DocumentAttachmentUpload,
  writeGeneration: AttachmentWriteGeneration,
) {
  if (!isAttachmentWriteGenerationCurrent(state, writeGeneration)) return;
  const currentDoc = state.doc;

  if (!currentDoc || !canAttachFiles(state)) {
    state.runtime.util.log(
      "Documents: slot attachments require a local key package.",
    );
    return;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }

  const replacementAttachment: DocumentAttachment = {
    byteLength: blobByteSourceInputLength(file.bytes),
    mimeType: file.mimeType,
    name: file.name,
    slotId,
  };
  const rollbackSnapshot = exportFullHistorySnapshot(currentDoc).slice();
  addDocumentAttachments(currentDoc, [replacementAttachment]);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  const coveredVersion = encodeVersionVector(currentDoc);

  const storageKey = `${state.localId}-${slotId}-${crypto.randomUUID()}`;
  const pendingAttachment: PendingAttachmentRecord = {
    byteLength: replacementAttachment.byteLength,
    localId: state.localId,
    mimeType: replacementAttachment.mimeType,
    name: replacementAttachment.name,
    slotId,
    storageKey,
  };
  let staged: Awaited<ReturnType<typeof stagePendingAttachments>>;
  try {
    staged = await stagePendingAttachments({
      files: [file],
      generation,
      pendingAttachments: [pendingAttachment],
      state,
    });
  } catch (error) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot,
      state,
    });
    throw error;
  }
  if (!staged) {
    await restoreFailedAttachmentMutation({
      generation,
      rollbackSnapshot,
      state,
    });
    return;
  }
  // Preserve the optimistic text/structured fields (see persistAttachedFiles):
  // a slot replacement overlapping a keystroke must not regress the editor.
  const persisted = await persistStagedAttachmentMutation({
    attachmentUpdate,
    coveredVersion,
    currentDoc,
    generation,
    rollbackSnapshot,
    staged,
    state,
  });
  if (
    shouldAbortAttachmentPersistFollowup(
      state,
      writeGeneration,
      generation,
      persisted,
    )
  ) {
    await deleteUnreferencedStagedAttachmentBytes({
      generation,
      pendingAttachments: staged.pendingAttachments,
      state,
    });
    return;
  }
  installPendingAttachmentRows({ ...staged, state });
  advancePendingBaseVersion(state, currentDoc);
  state.runtime.util.log(`Queued attachment ${file.name} for slot ${slotId}.`);
  requestDocumentStoreSync(state);
}

async function installCommittedAttachmentRemoval(input: {
  currentDoc: NonNullable<DocumentStoreState["doc"]>;
  slotId: string;
  state: DocumentStoreState;
  storageKey: string | undefined;
  syncedAttachment: boolean;
}): Promise<void> {
  const { slotId, state, storageKey } = input;
  if (!storageKey) return;
  state.pendingAttachments = state.pendingAttachments.filter(
    (attachment) =>
      attachment.slotId !== slotId || attachment.storageKey !== storageKey,
  );
  if (
    input.syncedAttachment ||
    state.attachmentStorageKeyBySlotId[slotId] !== storageKey
  ) {
    return;
  }
  const { [slotId]: _removedStorageKey, ...nextStorageKeys } =
    state.attachmentStorageKeyBySlotId;
  const { [slotId]: _removedBlobId, ...nextBlobIds } =
    state.attachmentBlobIdBySlotId;
  state.attachmentStorageKeyBySlotId = nextStorageKeys;
  state.attachmentBlobIdBySlotId = nextBlobIds;
  await state.runtime.infra.blobStore
    .deleteBytes(storageKey)
    .catch(() =>
      state.runtime.util.log(
        `Documents: failed to delete detached attachment bytes for ${slotId}.`,
      ),
    );
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

  const storageKey = state.attachmentStorageKeyBySlotId[slotId];
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
  await installCommittedAttachmentRemoval({
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

  const writeGeneration = captureAttachmentWriteGeneration(state);
  if (!writeGeneration) return;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistAttachedFiles(state, files, writeGeneration))
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

  const writeGeneration = captureAttachmentWriteGeneration(state);
  if (!writeGeneration) return;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => persistRemovedAttachment(state, slotId, writeGeneration))
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

  const writeGeneration = captureAttachmentWriteGeneration(state);
  if (!writeGeneration) return;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () =>
      persistSlotAttachmentFile(state, slotId, file, writeGeneration),
    )
    .catch((error: unknown) => {
      console.error("Failed to replace document attachment:", error);
    });
  return state.writeChain;
}
