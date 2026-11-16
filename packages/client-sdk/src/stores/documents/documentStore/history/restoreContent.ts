import { encodeVersionVector } from "@tearleads/loro";
import {
  type DocumentRestoreContent,
  restoreDocumentContent,
} from "../../../../data/documents/documentRestore";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../../registry";
import type { DocumentMutationGuard } from "../../types";
import { ensureDocumentStoreReady } from "../initialization";
import { chainQueuedWrite } from "../localWriteQueue";
import { settleDocumentLocalWrite } from "../mutations";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "../persistence";
import { reportDocumentStoreWriteFailure } from "../reportWriteFailure";
import { resolveRowAttribution } from "../rows/rowAttribution";
import {
  canWriteDocument,
  type DocumentStoreState,
  type SaveDocumentRecordOptions,
} from "../state";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";

// Fixed literal: a reported message must never carry document content.
const RESTORE_FAILURE_MESSAGE = "Documents: content restore failed";

/**
 * Leads the commit message of every restore. The rest of the message is
 * random, so two restores in a row are two steps as well.
 */
const DOCUMENT_RESTORE_COMMIT_MESSAGE = "restore";

/**
 * Apply and persist one restore. Resolves true when the document durably
 * holds the content: it was written and saved, or it already matched.
 */
async function persistRestoredContent(
  state: DocumentStoreState,
  expectedLocalWriteGeneration: number,
  content: DocumentRestoreContent,
  options: DocumentMutationGuard,
): Promise<boolean> {
  if (state.localWriteGeneration !== expectedLocalWriteGeneration) {
    return false;
  }
  const currentDoc = state.doc;
  if (!currentDoc || !canWriteDocument(state)) {
    return false;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation || options.stillCurrent?.() === false) {
    return false;
  }

  // A restore is always its own step of history. Loro folds a writer's
  // commits into one change while they fall within the merge interval, which
  // would fold a restore into the edit it replaces and take that version off
  // the timeline. Changes with different messages never share a change, so
  // close the edits before it and give the restore a message of its own.
  currentDoc.commit();
  const changed = restoreDocumentContent(
    currentDoc,
    content,
    resolveRowAttribution(state),
    state.runtime.infra.documentProjectors,
  );
  if (changed) {
    currentDoc.commit({
      message: `${DOCUMENT_RESTORE_COMMIT_MESSAGE} ${crypto.randomUUID()}`,
    });
  }
  // Every operation since the last persisted base travels in this update,
  // including edits an earlier failed save left behind.
  const update = pendingDeltaSinceBase(state, currentDoc);
  const pendingUpdate =
    update.byteLength === 0 ? null : createPendingUpdateFields(update);
  // The persist keeps whatever text and fields are on screen: an edit queued
  // behind this restore has already shown its value, and publishing the
  // restored document over it would regress an editor the user is typing in.
  // The restored content is published when the local writes drain
  // (settleDocumentLocalWrite), as it is for every other write.
  const saveOptions: SaveDocumentRecordOptions = {
    preserveSnapshotStructuredFields: true,
    preserveSnapshotText: true,
  };
  if (!pendingUpdate) {
    // Already this content: nothing to save, only the identity to revalidate.
    return isPersistedAndCurrent(
      state,
      generation,
      await persistDocument(state, currentDoc, {}, saveOptions, generation),
    );
  }
  const coveredVersion = encodeVersionVector(currentDoc);
  // From here until a persist covers it, the doc holds edits SQLite lacks.
  state.unsavedLocalEdits = true;
  const persisted = await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: coveredVersion },
    { ...saveOptions, pendingUpdate },
    generation,
  );
  if (!isPersistedAndCurrent(state, generation, persisted)) {
    return false;
  }
  advancePendingBaseVersion(state, currentDoc);
  requestDocumentStoreSync(state);
  return true;
}

/**
 * Whether a persist landed on the document this write started against. A
 * refused persist, a lost compare-and-set, or a superseded generation means
 * the store now holds something else.
 */
function isPersistedAndCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  persisted: Awaited<ReturnType<typeof persistDocument>>,
): boolean {
  return (
    persisted !== null &&
    !persisted.pullContinuationSuperseded &&
    !persisted.syncIdentitySuperseded &&
    isDocumentStoreSyncGenerationCurrent(state, generation)
  );
}

/**
 * Restore the document to `content` as one ordinary local write, queued
 * behind the writes already in flight. Resolves false when the restore was
 * refused or did not persist: the store is not ready, the document cannot be
 * written, the caller's guard expired, or the save failed.
 */
export async function restoreDocumentStoreContent(
  state: DocumentStoreState,
  scheduleSync: () => void,
  content: DocumentRestoreContent,
  options: DocumentMutationGuard = {},
): Promise<boolean> {
  let ready: boolean;
  try {
    ready = await ensureDocumentStoreReady(state, scheduleSync);
    if (options.stillCurrent?.() === false) ready = false;
  } catch (error) {
    reportDocumentStoreWriteFailure(state, RESTORE_FAILURE_MESSAGE, error);
    return false;
  }
  if (!ready || !state.doc || !canWriteDocument(state)) {
    return false;
  }

  const writeGeneration = state.localWriteGeneration;
  let restored = false;
  // Counted as a local write in flight, like a text or field write: while the
  // count is above zero a sync pass keeps the snapshot on screen, and the
  // document is published once the count drains.
  state.pendingLocalWrites += 1;
  await chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(async () => {
        restored = await persistRestoredContent(
          state,
          writeGeneration,
          content,
          options,
        );
      })
      .catch((error: unknown) => {
        reportDocumentStoreWriteFailure(state, RESTORE_FAILURE_MESSAGE, error);
      })
      // Always settle, so the count cannot stick above zero.
      .finally(() => {
        settleDocumentLocalWrite(state, writeGeneration);
      }),
  );
  return restored;
}
