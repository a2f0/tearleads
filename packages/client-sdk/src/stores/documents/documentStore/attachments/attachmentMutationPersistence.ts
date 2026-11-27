import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  classifyDatabaseFailure,
  retryWhileDatabaseBusy,
} from "../../../../workflows/documents";
import { requestDocumentStoreSync } from "../../registry";
import {
  deleteUnreferencedStagedAttachmentBytes,
  type stagePendingAttachments,
} from "../attachmentUpload/attachmentStaging";
import { reloadDocumentFromDurableHistory } from "../history/durableDocumentReload";
import { ensureDocumentStoreInitialized } from "../initialization";
import { persistDocument } from "../persistence";
import { noteDocumentStoreWrite } from "../reportWriteFailure";
import { type DocumentStoreState, resetDocumentStore } from "../state";
import {
  type captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";

export async function restoreFailedAttachmentMutation(input: {
  generation: NonNullable<
    ReturnType<typeof captureDocumentStoreSyncGeneration>
  >;
  rollbackSnapshot: Uint8Array;
  state: DocumentStoreState;
}): Promise<void> {
  try {
    await reloadDocumentFromDurableHistory({
      expectedGeneration: input.generation,
      preserveQueuedWritesWhenIdentityMatches: true,
      sameIdentitySnapshot: input.rollbackSnapshot,
      state: input.state,
    });
  } catch {
    // If SQLite cannot reload durable history (e.g. still busy after retries
    // exhausted), never leave uncommitted attachment ops in the live doc for a
    // later edit or sync pass to leak: reset and reinitialize from durable
    // history, matching settleDeferredInitialUpdate.
    if (
      isDocumentStoreSyncGenerationCurrent(input.state, input.generation) &&
      input.state.doc
    ) {
      resetDocumentStore(input.state);
      ensureDocumentStoreInitialized(input.state, () =>
        requestDocumentStoreSync(input.state),
      );
    }
  }
}

export async function persistStagedAttachmentMutation(input: {
  attachmentUpdate: Uint8Array;
  coveredVersion: string;
  currentDoc: NonNullable<DocumentStoreState["doc"]>;
  generation: NonNullable<
    ReturnType<typeof captureDocumentStoreSyncGeneration>
  >;
  rollbackSnapshot: Uint8Array;
  staged: NonNullable<Awaited<ReturnType<typeof stagePendingAttachments>>>;
  state: DocumentStoreState;
}) {
  const { staged, state } = input;
  try {
    // A busy refusal ran zero SQLite statements while staged bytes and the
    // mutated doc are still intact, so retrying the atomic persist in place
    // completes the attach/replace without rolling back or restaging (#3373).
    return await retryWhileDatabaseBusy(
      () =>
        persistDocument(
          state,
          input.currentDoc,
          { snapshotEndVersion: input.coveredVersion },
          {
            attachmentStaging: staged,
            pendingUpdate:
              createPendingUpdateFields(input.attachmentUpdate) ?? undefined,
            preserveSnapshotStructuredFields: true,
            preserveSnapshotText: true,
          },
          input.generation,
        ),
      {
        isCurrent: () =>
          isDocumentStoreSyncGenerationCurrent(state, input.generation),
        onBusy: () => {
          noteDocumentStoreWrite(
            state,
            `Documents: retrying attachment persist for ${state.localId} behind another tab's database transaction`,
          );
        },
      },
    );
  } catch (error) {
    await deleteUnreferencedStagedAttachmentBytes({
      generation: input.generation,
      pendingAttachments: staged.pendingAttachments,
      state,
    });
    if (
      classifyDatabaseFailure(error) === "busy" &&
      !isDocumentStoreSyncGenerationCurrent(state, input.generation)
    ) {
      return null;
    }
    await restoreFailedAttachmentMutation({
      generation: input.generation,
      rollbackSnapshot: input.rollbackSnapshot,
      state,
    });
    throw error;
  }
}
