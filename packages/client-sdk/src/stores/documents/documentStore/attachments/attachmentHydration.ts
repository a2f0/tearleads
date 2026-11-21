/** Hydrate only bytes matching the current document's authenticated attachment intent. */

import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import type { DocumentRecord } from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import type { DocumentState, DocumentStoreState } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { commitHydratedAttachment } from "./attachmentHydrationCommit";
import { hydrationBlobIdBySlotId } from "./heldCopyChecks";

// A remote probe is evidence that bindings may have moved independently of
// content. Capture its sequence before I/O so a hint arriving during hydration
// survives for the trailing pass. Missing or changed local bytes always retry.
const checkedSignals = new WeakMap<
  DocumentStoreState,
  { documentId: string; document: WeakRef<DocumentState>; sequence: number }
>();

export async function hydrateAttachmentBlobs(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord | null,
  policyOperation: PrincipalPolicyOperation,
  expectedGeneration?: DocumentStoreSyncGeneration,
) {
  // A view displaced by a relink stops downloading for a record that no
  // longer owns this document id, including a download already in flight.
  const generationIsCurrent = () =>
    !state.relinkedElsewhere &&
    (!expectedGeneration || isSyncGenerationCurrent(state, expectedGeneration));
  if (!generationIsCurrent()) return;

  const runtime = state.runtime;
  const encapsulationKeyPair = runtime.crypto.encapsulationKeyPair;
  if (
    !encapsulationKeyPair ||
    !runtime.auth.isAuthenticated ||
    !runtime.state.online ||
    !currentRecord?.documentId
  ) {
    return;
  }

  const attachments = getDocumentAttachments(currentDoc);
  if (attachments.length === 0) {
    return;
  }

  const signalSequence = state.remoteUpdateSignalSeq;
  if (
    bindingsAlreadyChecked(
      state,
      currentDoc,
      currentRecord.documentId,
      attachments,
      signalSequence,
    )
  )
    return;

  const expectedStorageKeys = { ...state.attachmentStorageKeyBySlotId };
  let bindingsChecked = false;
  const hydratedBlobs =
    await runtime.blobAttachments.hydrateDocumentAttachmentBlobs({
      onBindingsChecked: () => {
        bindingsChecked = true;
      },
      attachments,
      documentId: currentRecord.documentId,
      localBlobIdBySlotId: hydrationBlobIdBySlotId(state),
      localStorageKeyBySlotId: state.attachmentStorageKeyBySlotId,
      rejectedServedBindings: state.rejectedServedAttachmentBindings,
      resolveProjectionUserKey:
        expectedGeneration?.resolveProjectionUserKey ??
        state.resolveProjectionUserKey,
      stillCurrent: generationIsCurrent,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer({
        operation: policyOperation,
      }),
    });
  if (!generationIsCurrent()) return;
  if (!hydratedBlobs) {
    return;
  }

  for (const hydratedBlob of hydratedBlobs) {
    await commitHydratedAttachment({
      state,
      currentDoc,
      hydratedBlob,
      generationIsCurrent,
      expectedStorageKey:
        expectedStorageKeys[hydratedBlob.attachment.slotId] ?? null,
    });
  }
  if (
    bindingsChecked &&
    generationIsCurrent() &&
    hydratedBlobs.every(
      (blob) =>
        state.attachmentBlobIdBySlotId[blob.attachment.slotId] ===
        blob.binding.blobId,
    )
  ) {
    checkedSignals.set(state, {
      documentId: currentRecord.documentId,
      document: new WeakRef(currentDoc),
      sequence: signalSequence,
    });
  }
  void runDocumentOrphanMaintenance(state);
}

function bindingsAlreadyChecked(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  documentId: string,
  attachments: ReturnType<typeof getDocumentAttachments>,
  signalSequence: number,
): boolean {
  const checked = checkedSignals.get(state);
  const needsBindingProbe =
    signalSequence >
    (checked?.documentId === documentId &&
    checked.document.deref() === currentDoc
      ? checked.sequence
      : 0);
  return (
    !needsBindingProbe &&
    attachments.every(
      (attachment) =>
        state.attachmentStorageKeyBySlotId[attachment.slotId] &&
        state.attachmentContentSha256BySlotId[attachment.slotId] ===
          attachment.contentSha256,
    )
  );
}
