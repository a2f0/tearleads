import type { loadPersistedDocumentStoreState } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

export type LoadedDocumentStoreState = Awaited<
  ReturnType<typeof loadPersistedDocumentStoreState>
>;

export function installPersistedAttachments(
  state: DocumentStoreState,
  persistedState: LoadedDocumentStoreState,
): void {
  state.pendingAttachments = persistedState.pendingAttachments;
  state.attachmentBlobIdBySlotId = Object.fromEntries(
    persistedState.localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.blobId,
    ]),
  );
  state.attachmentStorageKeyBySlotId = Object.fromEntries(
    persistedState.localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.storageKey,
    ]),
  );
}
