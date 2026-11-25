import type {
  DocumentRecord,
  DocumentSyncLoroWindow,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "../state";
import {
  findOwedListingReadBeforePull,
  settleOwedListingReadAfterCompletedPull,
} from "./listingCoverage";
import { logRevalidationUnavailable as logUnavailable } from "./remoteRevalidationTelemetry";
import { finalizeDocumentSync } from "./syncFinalize";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

interface AttachmentRevalidation {
  readonly canSyncAttachments: boolean;
  readonly nextRecord: DocumentRecord;
}

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
  loroWindow: DocumentSyncLoroWindow,
): Promise<AttachmentRevalidation> {
  if (state.pendingAttachments.length === 0) {
    return { canSyncAttachments: true, nextRecord };
  }
  return pullRemoteDocumentForAttachments(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
    policyOperation,
    loroWindow,
  );
}

/**
 * Pulls a remote document without sending queued updates, as a pass does
 * before its attachments upload and again after the API refused a bind
 * because the document advanced. Attachments may bind only once the pull is
 * complete and the pass is still current.
 */
export async function pullRemoteDocumentForAttachments(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation: DocumentStoreSyncGeneration,
  policyOperation: PrincipalPolicyOperation,
  /** The pass's read window, which the pull reads in. */
  loroWindow: DocumentSyncLoroWindow,
): Promise<AttachmentRevalidation> {
  if (!nextRecord.documentId) {
    return { canSyncAttachments: true, nextRecord };
  }

  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const wasRemoteProbe = state.remoteUpdatePending;
  // This pull consumes the probe signal, so it also answers the read a
  // listing owes: the pass's later pull would no longer look for the debt.
  const owedListingRead = await findOwedListingReadBeforePull(
    state,
    generation,
    { documentId: nextRecord.documentId, remoteProbe: wasRemoteProbe },
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return { canSyncAttachments: false, nextRecord };
  }
  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRecord,
    encapsulationKeyPair,
    generation,
    pendingUpdates: [],
    loroWindow,
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
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: refreshedRecord.snapshotEndVersion,
    owed: owedListingRead,
    pull: syncAttempt.synced,
  });
  return {
    canSyncAttachments:
      !syncAttempt.synced.hasIncompletePull &&
      !syncAttempt.synced.hasHeldPull &&
      refreshedRecord.pullContinuation == null &&
      refreshedRecord.pullContinuationRecoveryRequired !== true &&
      isDocumentStoreSyncGenerationCurrent(state, generation),
    nextRecord: refreshedRecord,
  };
}
