/**
 * Download and store the blob bytes for a synced document's attachment slots.
 *
 * This runs inside a sync pass, so every write it makes is re-checked against
 * the pass's generation. Byte writes and their live rows share a blob-key lock
 * with orphan reclamation, and the rows go through
 * `saveLocalAttachmentRecords` — which realigns them with the document, so a
 * slot unlinked mid-hydration is written detached rather than live.
 */
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { hydrateDocumentAttachmentBlobs } from "../../../workflows/blobs";
import {
  type DocumentRecord,
  type LocalAttachmentRecord,
  runSerializedDocumentBlobMutation,
} from "../../../workflows/documents";
import { saveLocalAttachmentRecords } from "./persistence";
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

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: runtime.apiClient,
    attachments,
    documentId: currentRecord.documentId,
    execSql: runtime.infra.execSql,
    localBlobIdBySlotId: state.attachmentBlobIdBySlotId,
    localStorageKeyBySlotId: state.attachmentStorageKeyBySlotId,
    log: runtime.util.log,
    resolveProjectionUserKey:
      expectedGeneration?.resolveProjectionUserKey ??
      state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!generationIsCurrent()) return;
  if (!hydratedBlobs) {
    return;
  }

  const replacedStorageKeys: string[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    const stored = await runSerializedDocumentBlobMutation(
      runtime.infra.execSql,
      hydratedBlob.storageKey,
      async () => {
        if (!generationIsCurrent()) return null;
        const previousStorageKey =
          state.attachmentStorageKeyBySlotId[hydratedBlob.attachment.slotId];
        await runtime.infra.blobStore.writeBytes(
          hydratedBlob.storageKey,
          hydratedBlob.bytes,
        );
        if (!generationIsCurrent()) return null;
        const localAttachmentRecord: LocalAttachmentRecord = {
          blobId: hydratedBlob.binding.blobId,
          byteLength: hydratedBlob.attachment.byteLength,
          detachedAt: null,
          localId: state.localId,
          mimeType: hydratedBlob.attachment.mimeType,
          slotId: hydratedBlob.attachment.slotId,
          storageKey: hydratedBlob.storageKey,
        };

        await saveLocalAttachmentRecords(
          state,
          [localAttachmentRecord],
          currentDoc,
          expectedGeneration,
        );
        return generationIsCurrent() ? previousStorageKey : null;
      },
    );
    if (stored === null) return;
    if (stored && stored !== hydratedBlob.storageKey) {
      replacedStorageKeys.push(stored);
    }
  }

  await Promise.allSettled(
    replacedStorageKeys.map((storageKey) =>
      runtime.infra.blobStore.deleteBytes(storageKey),
    ),
  );
}
