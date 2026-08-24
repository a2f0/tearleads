import { requestDocumentStoreSync } from "../registry";
import { attachmentPersistNeedsFollowupSync } from "./attachmentPersistFollowup";
import type { DocumentStoreState, PersistedDocumentRecord } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

export interface AttachmentWriteGeneration {
  documentId: string | null;
  localWriteGeneration: number;
}

export function captureAttachmentWriteGeneration(
  state: DocumentStoreState,
): AttachmentWriteGeneration | null {
  if (!state.record) return null;
  return {
    documentId: state.record.documentId,
    localWriteGeneration: state.localWriteGeneration,
  };
}

export function isAttachmentWriteGenerationCurrent(
  state: DocumentStoreState,
  generation: AttachmentWriteGeneration,
): boolean {
  return (
    state.localWriteGeneration === generation.localWriteGeneration &&
    state.record?.documentId === generation.documentId
  );
}

export function shouldAbortAttachmentPersistFollowup(
  state: DocumentStoreState,
  writeGeneration: AttachmentWriteGeneration,
  syncGeneration: DocumentStoreSyncGeneration,
  persisted: PersistedDocumentRecord | null,
): boolean {
  if (
    attachmentPersistNeedsFollowupSync({
      currentDocumentId: state.record?.documentId,
      currentLocalWriteGeneration: state.localWriteGeneration,
      expectedDocumentId: writeGeneration.documentId,
      expectedLocalWriteGeneration: writeGeneration.localWriteGeneration,
      persisted,
    })
  ) {
    requestDocumentStoreSync(state);
  }
  if (!persisted) return true;

  return (
    persisted.pullContinuationSuperseded === true ||
    persisted.syncIdentitySuperseded === true ||
    !isDocumentStoreSyncGenerationCurrent(state, syncGeneration)
  );
}
