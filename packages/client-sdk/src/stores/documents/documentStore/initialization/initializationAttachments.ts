import type { loadPersistedDocumentStoreState } from "../../../../workflows/documents";
import { assignLocalAttachmentSlots } from "../attachments/attachmentPersistence";
import { reloadDocumentChangedPasses } from "../attachmentUpload/attachmentDocumentVersion";
import type { DocumentStoreState } from "../state";

export type LoadedDocumentStoreState = Awaited<
  ReturnType<typeof loadPersistedDocumentStoreState>
>;

export function installPersistedAttachments(
  state: DocumentStoreState,
  persistedState: LoadedDocumentStoreState,
): void {
  state.pendingAttachments = persistedState.pendingAttachments;
  reloadDocumentChangedPasses(state);
  state.attachmentBlobIdBySlotId = {};
  state.attachmentContentSha256BySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  assignLocalAttachmentSlots(state, persistedState.localAttachments);
}
