import type { DocumentRecord } from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/runtimePolicyWarmer";
import { requestDocumentStoreSync } from "../../registry";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "../state";
import { logRevalidationUnavailable as logUnavailable } from "./remoteRevalidationTelemetry";
import { finalizeDocumentSync } from "./syncFinalize";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

/**
 * Syncs a remote document before its pending attachments upload; they wait
 * while that pull is incomplete or the pass is stale.
 */
export async function revalidateRemoteDocumentBeforeAttachments(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation: DocumentStoreSyncGeneration,
  policyOperation: PrincipalPolicyOperation,
): Promise<{ canSyncAttachments: boolean; nextRecord: DocumentRecord }> {
  if (state.pendingAttachments.length === 0 || !nextRecord.documentId) {
    return { canSyncAttachments: true, nextRecord };
  }

  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const wasRemoteProbe = state.remoteUpdatePending;
  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRecord,
    encapsulationKeyPair,
    generation,
    pendingUpdates: [],
    policyOperation,
    unavailableWriterLogMessage:
      "Documents: skipped pre-attachment revalidation because the writer context is unavailable.",
  });
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return { canSyncAttachments: false, nextRecord };
  }
  if (!syncAttempt) {
    logUnavailable(state, wasRemoteProbe);
    return { canSyncAttachments: false, nextRecord };
  }

  const refreshedRecord = await finalizeDocumentSync(
    state,
    currentDoc,
    nextRecord,
    syncAttempt,
    consumedRemoteUpdateSignalSeq,
    generation,
    [],
    wasRemoteProbe,
  );
  return {
    canSyncAttachments:
      !syncAttempt.synced.hasIncompletePull &&
      refreshedRecord.pullContinuation == null &&
      refreshedRecord.pullContinuationRecoveryRequired !== true &&
      isDocumentStoreSyncGenerationCurrent(state, generation),
    nextRecord: refreshedRecord,
  };
}
