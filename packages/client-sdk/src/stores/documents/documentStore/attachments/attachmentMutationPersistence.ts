import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../../registry";
import {
  deleteUnreferencedStagedAttachmentBytes,
  type stagePendingAttachments,
} from "../attachmentUpload/attachmentStaging";
import { reloadDocumentFromDurableHistory } from "../history/durableDocumentReload";
import { ensureDocumentStoreInitialized } from "../initialization";
import { persistDocument } from "../persistence";
import { retryDocumentStoreWorkWhileBusy } from "../reportWriteFailure";
import { type DocumentStoreState, resetDocumentStore } from "../state";
import {
  type captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import {
  type AttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
} from "./attachmentWriteGeneration";

// Fixed literal: a reported message must never carry file names or slot ids.
export const ATTACHMENT_FAILURE_MESSAGE =
  "Documents: attachment mutation failed";

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
    // If durable reload also failed (for example, another tab kept SQLite busy
    // past the retry budget), drop the mutated live doc and reinitialize so an
    // uncommitted attachment slot or removal can never leak into a later edit.
    if (isDocumentStoreSyncGenerationCurrent(input.state, input.generation)) {
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
  writeGeneration: AttachmentWriteGeneration;
}) {
  const { staged, state } = input;
  try {
    // Blob bytes are already staged under `staged.pendingAttachments` and
    // `persistDocument` commits the attachment rows, history tail, pending
    // update, and document record in one SQLite transaction, so retrying a
    // busy refusal commits all SQLite records together or none at all.
    return await retryDocumentStoreWorkWhileBusy(
      state,
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
        busyMessage: ATTACHMENT_FAILURE_MESSAGE,
        isCurrent: () =>
          isAttachmentWriteGenerationCurrent(state, input.writeGeneration) &&
          isDocumentStoreSyncGenerationCurrent(state, input.generation),
      },
    );
  } catch (error) {
    await deleteUnreferencedStagedAttachmentBytes({
      generation: input.generation,
      pendingAttachments: staged.pendingAttachments,
      state,
    });
    await restoreFailedAttachmentMutation({
      generation: input.generation,
      rollbackSnapshot: input.rollbackSnapshot,
      state,
    });
    throw error;
  }
}
