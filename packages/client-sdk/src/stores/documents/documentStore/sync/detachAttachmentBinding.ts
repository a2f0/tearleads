import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import {
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import type { DocumentAttachmentBinding, DocumentStoreState } from "../state";
import { installDocumentWriterProjection } from "../writerProjectionGeneration";
import { recordAttachmentSlotDetach } from "./removedSlotDetaches";
import type { SyncedDocumentView } from "./syncedDocumentView";
import {
  allowDocumentStoreRemoteSync,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import { documentSyncContextMatches } from "./syncUpdateImport";

export function detachedSyncContextIsCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  requestRecord: DocumentRecord,
): boolean {
  return (
    !state.runtime.util.deferAttachmentDetaches &&
    isDocumentStoreSyncGenerationCurrent(state, generation) &&
    documentSyncContextMatches(
      state.record,
      requestRecord,
      requestRecord.documentId,
    )
  );
}

/**
 * The API refused the detach because the document, or the version the
 * binding was bound at, holds an op the view lacks. Ask once for a pass that
 * pulls: a slot restored meanwhile then keeps its binding, and a removal that
 * stands is detached at the newer version.
 */
function recordDocumentChanged(
  state: DocumentStoreState,
  binding: DocumentAttachmentBinding,
  view: SyncedDocumentView,
): void {
  recordAttachmentSlotDetach(state, binding.slotId, {
    bindingId: binding.bindingId,
    type: "detachRefused",
    versionVector: view.versionVector,
  });
  // As every remote request does: a relink or an abandoned wait may have
  // blocked remote sync, which would return the pass before its pull.
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  requestDocumentStoreSync(state);
}

/**
 * Detach `binding` at the version of `view`, which must lack its slot. True
 * when the API detached it; a refusal for a newer document records itself
 * and requests a pull.
 */
export async function detachAttachmentBinding(input: {
  binding: DocumentAttachmentBinding;
  generation: DocumentStoreSyncGeneration;
  policyOperation: PrincipalPolicyOperation;
  remoteDocumentId: string;
  requestRecord: DocumentRecord;
  state: DocumentStoreState;
  view: SyncedDocumentView;
}): Promise<boolean> {
  const { binding, generation, requestRecord, state, view } = input;
  const contextIsCurrent = () =>
    detachedSyncContextIsCurrent(state, generation, requestRecord);
  if (!contextIsCurrent() || view.slotIds.has(binding.slotId)) return false;

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment detach because the writer context is unavailable.",
    );
    return false;
  }

  const writerProjection =
    state.writerProjection?.documentId === input.remoteDocumentId &&
    !isRejectedDecodedProjection(state.writerProjection)
      ? state.writerProjection
      : null;
  const writerProjectionGeneration = state.writerProjectionGeneration;
  let remoteSyncBlocked = false;
  let documentChanged = false;
  // Read with the currency check above, so its executor is this generation's.
  const { blobAttachments } = state.runtime;
  const baseDetachInput = {
    author,
    bindingId: binding.bindingId,
    blobId: binding.blobId,
    documentId: input.remoteDocumentId,
    documentVersionVector: view.versionVector,
    isRemoteSyncBlocked: (organizationId: string) => {
      remoteSyncBlocked =
        state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
      return remoteSyncBlocked;
    },
    onDocumentChanged: () => {
      documentChanged = true;
    },
    resolveProjectionUserKey: generation.resolveProjectionUserKey,
    slotId: binding.slotId,
    stillCurrent: contextIsCurrent,
    warmReferencedPrincipalPolicies:
      state.runtime.principalPolicies.createWarmer({
        operation: input.policyOperation,
      }),
  };
  let detached = await blobAttachments.detachDocumentAttachment({
    ...baseDetachInput,
    writerProjection: writerProjection ?? undefined,
  });
  if (!contextIsCurrent()) return false;
  if (!detached && writerProjection && !remoteSyncBlocked && !documentChanged) {
    state.writerProjection = null;
    detached = await blobAttachments.detachDocumentAttachment(baseDetachInput);
    if (!contextIsCurrent()) return false;
  }
  if (!detached) {
    if (documentChanged) recordDocumentChanged(state, binding, view);
    return false;
  }

  installDocumentWriterProjection(
    state,
    detached.writerProjection,
    writerProjectionGeneration,
  );
  recordAttachmentSlotDetach(state, binding.slotId, { type: "settled" });
  state.runtime.util.log(
    `Detached attachment ${binding.slotId} from document ${input.remoteDocumentId}.`,
  );
  return true;
}
