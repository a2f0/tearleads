import type { DocumentRecord } from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import type { DocumentAttachmentBinding, DocumentStoreState } from "../state";
import { detachAttachmentBinding } from "./detachAttachmentBinding";
import {
  planAttachmentSlotDetach,
  recordAttachmentSlotDetach,
} from "./removedSlotDetaches";
import type { SyncedDocumentView } from "./syncedDocumentView";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

/**
 * Detach the bindings the server still lists for slots this store saw
 * recorded and `view` lacks, and forget a slot that has none. Bytes this
 * store never held leave no removal marker, so a removal that reached it
 * after the slot's bind is reconciled here. The API keeps the binding while
 * the document holds a committed op the view lacks, or the version it was
 * bound at holds an op not yet committed.
 */
export async function detachRemovedSlotBindings(input: {
  activeBindingBySlotId: ReadonlyMap<string, DocumentAttachmentBinding>;
  contextIsCurrent: () => boolean;
  generation: DocumentStoreSyncGeneration;
  policyOperation: PrincipalPolicyOperation;
  requestRecord: DocumentRecord;
  slotIds: readonly string[];
  state: DocumentStoreState;
  view: SyncedDocumentView;
}): Promise<void> {
  const { requestRecord, state, view } = input;
  const remoteDocumentId = requestRecord.documentId;
  if (!remoteDocumentId) return;
  for (const slotId of input.slotIds) {
    if (!input.contextIsCurrent()) return;
    const binding = input.activeBindingBySlotId.get(slotId);
    const step = planAttachmentSlotDetach(
      state,
      slotId,
      binding,
      view.versionVector,
    );
    if (step === "settle") {
      recordAttachmentSlotDetach(state, slotId, { type: "settled" });
    } else if (step === "detach" && binding) {
      await detachAttachmentBinding({
        binding,
        generation: input.generation,
        policyOperation: input.policyOperation,
        remoteDocumentId,
        requestRecord,
        state,
        view,
      });
    }
  }
}
