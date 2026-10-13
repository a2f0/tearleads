/** Hydrate only bytes matching the current document's authenticated attachment intent. */

import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { hydrateDocumentAttachmentBlobs } from "../../../workflows/blobs";
import type { DocumentRecord } from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { commitHydratedAttachment } from "./attachmentHydrationCommit";
import { runDocumentOrphanMaintenance } from "./orphanMaintenance";
import type { DocumentState, DocumentStoreState } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

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
  expectedGeneration?: DocumentStoreSyncGeneration,
) {
  const generationIsCurrent = () =>
    !expectedGeneration || isSyncGenerationCurrent(state, expectedGeneration);
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
  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: runtime.apiClient,
    onBindingsChecked: () => {
      bindingsChecked = true;
    },
    attachments,
    documentId: currentRecord.documentId,
    execSql: runtime.infra.execSql,
    localBlobIdBySlotId: state.attachmentBlobIdBySlotId,
    localStorageKeyBySlotId: state.attachmentStorageKeyBySlotId,
    log: runtime.util.log,
    rejectedServedBindings: state.rejectedServedAttachmentBindings,
    reportSecurityIncident: runtime.util.reportSecurityIncident,
    resolveProjectionUserKey:
      expectedGeneration?.resolveProjectionUserKey ??
      state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    stillCurrent: generationIsCurrent,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
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
