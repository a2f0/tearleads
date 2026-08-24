import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import {
  deleteUnreferencedStagedAttachmentBytes,
  type stagePendingAttachments,
} from "./attachmentStaging";
import { reloadDocumentFromDurableHistory } from "./durableDocumentReload";
import { persistDocument } from "./persistence";
import type { DocumentStoreState } from "./state";
import type { captureDocumentStoreSyncGeneration } from "./syncGeneration";

export async function restoreFailedAttachmentMutation(input: {
  generation: NonNullable<
    ReturnType<typeof captureDocumentStoreSyncGeneration>
  >;
  rollbackSnapshot: Uint8Array;
  state: DocumentStoreState;
}): Promise<void> {
  await reloadDocumentFromDurableHistory({
    expectedGeneration: input.generation,
    preserveQueuedWritesWhenIdentityMatches: true,
    sameIdentitySnapshot: input.rollbackSnapshot,
    state: input.state,
  });
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
    return await persistDocument(
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
