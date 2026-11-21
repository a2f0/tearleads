import type { loadPersistedDocumentStoreState } from "../../../../workflows/documents";
import { assignLocalAttachmentSlots } from "../attachments/attachmentPersistence";
import type { DocumentStoreState } from "../state";

export type LoadedDocumentStoreState = Awaited<
  ReturnType<typeof loadPersistedDocumentStoreState>
>;

export function installPersistedAttachments(
  state: DocumentStoreState,
  persistedState: LoadedDocumentStoreState,
): void {
  state.pendingAttachments = persistedState.pendingAttachments;
  // Loaded uploads start with a full budget of re-pulled passes, so one
  // that used it up before a reset pulls again on its next refusal.
  state.attachmentDocumentChangedPasses = undefined;
  state.attachmentBlobIdBySlotId = {};
  state.attachmentContentSha256BySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  assignLocalAttachmentSlots(state, persistedState.localAttachments);
}
