/** Hydrate only bytes matching the current document's authenticated attachment intent. */
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { hydrateDocumentAttachmentBlobs } from "../../../workflows/blobs";
import {
  type DocumentRecord,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import { commitHydratedAttachment } from "./attachmentHydrationCommit";
import type { DocumentState, DocumentStoreState } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

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

  const expectedStorageKeys = { ...state.attachmentStorageKeyBySlotId };
  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: runtime.apiClient,
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
  await reclaimDocumentOrphanBlobs(runtime);
}
