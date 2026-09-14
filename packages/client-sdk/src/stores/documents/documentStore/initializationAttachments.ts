import type { loadPersistedDocumentStoreState } from "../../../workflows/documents";
import { assignLocalAttachmentSlots } from "./attachmentPersistence";
import type { DocumentStoreState } from "./state";

export type LoadedDocumentStoreState = Awaited<
  ReturnType<typeof loadPersistedDocumentStoreState>
>;

export function installPersistedAttachments(
  state: DocumentStoreState,
  persistedState: LoadedDocumentStoreState,
): void {
  state.pendingAttachments = persistedState.pendingAttachments;
  state.attachmentBlobIdBySlotId = {};
  state.attachmentContentSha256BySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  assignLocalAttachmentSlots(state, persistedState.localAttachments);
}
