import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import type { PendingAttachmentRecord } from "../../../../workflows/documents";
import { requestDocumentStoreSync } from "../../registry";
import type { DocumentAttachmentUpload } from "../../types";
import {
  deleteUnreferencedStagedAttachmentBytes,
  installPendingAttachmentRows,
  stagePendingAttachments,
} from "../attachmentUpload/attachmentStaging";
import { ensureDocumentStoreReady } from "../initialization";
import { settleDeferredInitialUpdate } from "../initialization/deferredInitialUpdate";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
} from "../persistence";
import { reportDocumentStoreWriteFailure } from "../reportWriteFailure";
import {
  canAttachFiles,
  canWriteDocument,
  chainQueuedWrite,
  type DocumentStoreState,
} from "../state";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import {
  buildAttachmentIntent,
  buildPendingAttachments,
} from "./attachmentIntents";
import {
  persistStagedAttachmentMutation,
  restoreFailedAttachmentMutation,
} from "./attachmentMutationPersistence";
import {
  type AttachmentWriteGeneration,
  captureAttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
  shouldAbortAttachmentPersistFollowup,
} from "./attachmentWriteGeneration";

// Fixed literal: a reported message must never carry file names or slot ids.
export const ATTACHMENT_FAILURE_MESSAGE =
  "Documents: attachment mutation failed";

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

  const { nextAttachments, nextPendingAttachments } =
    await buildPendingAttachments(state.localId, files);
  if (
    !isAttachmentWriteGenerationCurrent(state, writeGeneration) ||
    state.doc !== currentDoc
  )
    return;
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

  const replacementAttachment = await buildAttachmentIntent(slotId, file);
  if (
    !isAttachmentWriteGenerationCurrent(state, writeGeneration) ||
    state.doc !== currentDoc
  )
    return;
  const rollbackSnapshot = exportFullHistorySnapshot(currentDoc).slice();
  addDocumentAttachments(currentDoc, [replacementAttachment]);
  const attachmentUpdate = pendingDeltaSinceBase(state, currentDoc);
  const coveredVersion = encodeVersionVector(currentDoc);

  const storageKey = `${state.localId}-${slotId}-${crypto.randomUUID()}`;
  const pendingAttachment: PendingAttachmentRecord = {
    byteLength: replacementAttachment.byteLength,
    contentSha256: replacementAttachment.contentSha256,
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

async function captureReadyAttachWrite(
  state: DocumentStoreState,
  scheduleSync: () => void,
  callGeneration: AttachmentWriteGeneration | null,
) {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
  } catch (error) {
    reportDocumentStoreWriteFailure(state, ATTACHMENT_FAILURE_MESSAGE, error);
    return null;
  }
  if (!ready || !state.doc || !canWriteDocument(state)) return null;
  // A reset or relink while this call waited owns the replacement document.
  if (
    callGeneration &&
    !isAttachmentWriteGenerationCurrent(state, callGeneration)
  ) {
    return null;
  }
  return captureAttachmentWriteGeneration(state);
}

async function attachThenSettle(
  state: DocumentStoreState,
  scheduleSync: () => void,
  files: ReadonlyArray<DocumentAttachmentUpload>,
  callGeneration: AttachmentWriteGeneration | null,
) {
  const writeGeneration =
    files.length === 0
      ? null
      : await captureReadyAttachWrite(state, scheduleSync, callGeneration);
  try {
    if (writeGeneration) {
      await persistAttachedFiles(state, files, writeGeneration);
    }
  } finally {
    await settleDeferredInitialUpdate(state, writeGeneration);
  }
}

export async function attachFilesToDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
  files: ReadonlyArray<DocumentAttachmentUpload>,
) {
  // Join the chain before awaiting readiness so settlements keep call order,
  // and settle even when nothing attaches: a deferred birth's sync hold lifts
  // only behind every earlier attach, never while one is still staging. The
  // caller's document is captured now (a cold store captures once ready).
  const callGeneration = captureAttachmentWriteGeneration(state);
  return chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(async () =>
        attachThenSettle(state, scheduleSync, files, callGeneration),
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
        persistSlotAttachmentFile(state, slotId, file, writeGeneration),
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
