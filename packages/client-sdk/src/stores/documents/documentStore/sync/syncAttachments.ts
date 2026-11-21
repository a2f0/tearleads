import {
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  DocumentRecordRepository,
  type PendingAttachmentRecord,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { markOriginatedDocuments } from "../../../../workflows/sync/coordination";
import { requestDocumentStoreSync } from "../../registry";
import type {
  DocumentAttachmentBinding,
  DocumentStoreState,
  EncapsulationKeyPair,
  PendingMutationSyncResult,
} from "../state";
import {
  type CarriedFirstUpdate,
  ensureRemoteDocumentCarryingFirstUpdate,
} from "./carriedFirstUpdate";
import {
  isNewPendingAttachmentSlot,
  removeSettledPendingAttachment,
} from "./syncAttachmentSettlement";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import {
  type PendingAttachmentUploadInput,
  syncPendingAttachmentUpload,
} from "./syncPendingAttachmentUpload";
import { pullRemoteDocumentForAttachments } from "./syncRevalidation";

interface AttachmentSyncProgress {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  fetchedRemoteBindings: boolean;
  settledAttachment: boolean;
  uploadedAttachment: boolean;
}

function rearmStaleAttachmentSync(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
): void {
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
  }
}

/**
 * Uploads and binds the queued attachments. The returned record is the one
 * the rest of the pass must sync from: a pull after a refused bind replaces
 * the record this pass started with.
 */
export async function syncPendingAttachments(input: {
  readonly attachmentGeneration: DocumentStoreSyncGeneration;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  /** The pass's remote generation; a pull after a refused bind runs under it. */
  readonly generation: DocumentStoreSyncGeneration;
  readonly nextRecord: DocumentRecord;
  readonly policyOperation: PrincipalPolicyOperation;
  readonly state: DocumentStoreState;
}): Promise<PendingMutationSyncResult> {
  const { attachmentGeneration, encapsulationKeyPair, policyOperation, state } =
    input;
  const currentDoc = state.doc;
  if (state.pendingAttachments.length === 0 || !currentDoc) {
    return { completed: false, nextRecord: input.nextRecord };
  }

  let carriedFirstUpdate: CarriedFirstUpdate | undefined;
  const startRecord = input.nextRecord.documentId
    ? input.nextRecord
    : await ensureRemoteDocumentCarryingFirstUpdate({
        currentDoc,
        encapsulationKeyPair,
        generation: attachmentGeneration,
        nextRecord: input.nextRecord,
        onCarried: (carried) => {
          carriedFirstUpdate = carried;
        },
        policyOperation,
        state,
      });
  if (!startRecord?.documentId) {
    return { completed: false, nextRecord: input.nextRecord };
  }
  const remoteDocumentId = startRecord.documentId;
  let passRecord = startRecord;
  const pullDocument = async () => {
    const pulled = await pullRemoteDocumentForAttachments(
      state,
      currentDoc,
      passRecord,
      encapsulationKeyPair,
      input.generation,
      policyOperation,
    );
    passRecord = pulled.nextRecord;
    return pulled.canSyncAttachments;
  };

  const progress: AttachmentSyncProgress = {
    activeBindingBySlotId: new Map(),
    fetchedRemoteBindings: false,
    settledAttachment: false,
    uploadedAttachment: false,
  };

  for (const pendingAttachment of [...state.pendingAttachments]) {
    const step = await syncNextPendingAttachment(
      {
        attachmentGeneration,
        carriedFirstUpdate,
        pendingAttachment,
        policyOperation,
        pullDocument,
        remoteDocumentId,
        state,
      },
      progress,
      currentDoc,
    );
    // Only the first bind may carry it; a failed one leaves the row queued.
    carriedFirstUpdate = undefined;
    if (step === "stop") {
      return {
        completed: progress.settledAttachment,
        nextRecord: passRecord,
      };
    }
  }

  if (!progress.settledAttachment) {
    return { completed: false, nextRecord: passRecord };
  }

  // Only record the origination once a write landed: the server echoes a
  // document_update_created for it, and this lets the reconciler skip
  // rediscovering a delta we already have locally rather than cycling its lane
  // per uploaded file. Marking here (not before the loop) avoids a dangling id
  // that would suppress the next genuine remote update if every upload failed.
  if (progress.uploadedAttachment) {
    markOriginatedDocuments(state.runtime.state.domainScope, [
      remoteDocumentId,
    ]);
  }

  // A settled attachment pass invalidates any recorded failure itself: a
  // retried upload with no pending CRDT update never reaches the document
  // submission that would otherwise clear it, and the stale row would flag the
  // next unrelated edit as failed before it was attempted.
  await new DocumentRecordRepository(
    state.runtime.infra.execSql,
  ).clearDocumentSyncFailure({
    appKind: DOCUMENTS_APP_KIND,
    localId: state.localId,
  });

  // The snapshot was already republished progressively inside the loop as each
  // attachment settled, so there is nothing left to publish here.
  return { completed: true, nextRecord: passRecord };
}

/** Settles one queued attachment; "stop" ends this pass early. */
async function syncNextPendingAttachment(
  upload: Omit<PendingAttachmentUploadInput, "activeBindingBySlotId">,
  progress: AttachmentSyncProgress,
  currentDoc: NonNullable<DocumentStoreState["doc"]>,
): Promise<"continue" | "stop"> {
  const { attachmentGeneration, pendingAttachment, state } = upload;
  if (!isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)) {
    requestDocumentStoreSync(state);
    return "stop";
  }
  if (!(await loadRemoteAttachmentBindings({ ...upload, progress }))) {
    return "stop";
  }
  const outcome = await syncPendingAttachmentUpload({
    ...upload,
    activeBindingBySlotId: progress.activeBindingBySlotId,
  });
  if (outcome === "retry") {
    rearmStaleAttachmentSync(state, attachmentGeneration);
    return "stop";
  }
  // Re-check after the upload's awaits: settling writes local rows, which a
  // teardown that happened mid-upload has just deleted on purpose.
  if (!isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)) {
    requestDocumentStoreSync(state);
    return "stop";
  }
  removeSettledPendingAttachment(state, currentDoc, pendingAttachment);
  if (outcome === "uploaded" || outcome === "recovered") {
    progress.settledAttachment = true;
  }
  if (outcome === "uploaded") progress.uploadedAttachment = true;
  return "continue";
}

async function loadRemoteAttachmentBindings(input: {
  pendingAttachment: PendingAttachmentRecord;
  progress: AttachmentSyncProgress;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { pendingAttachment, progress, state } = input;
  const freshUpload =
    pendingAttachment.upload == null &&
    isNewPendingAttachmentSlot(state, pendingAttachment);
  if (progress.fetchedRemoteBindings || freshUpload) {
    return true;
  }

  const remoteBindings = await state.runtime.apiClient.listDocumentAttachments(
    input.remoteDocumentId,
  );
  if (!remoteBindings) {
    return false;
  }

  progress.fetchedRemoteBindings = true;
  for (const binding of remoteBindings) {
    progress.activeBindingBySlotId.set(binding.slotId, binding);
  }
  return true;
}
