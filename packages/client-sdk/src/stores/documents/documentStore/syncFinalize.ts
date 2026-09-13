import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  getImportBlobMetadata,
  mergeVersionVectors,
} from "@tearleads/loro";
import { readPullContinuation } from "../../../data/documents/shared/syncPagination";
import {
  type DocumentRecord,
  settleOutgoingPassAndDecideReArm,
  shouldClearDocumentSyncFailureAfterPass,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import { chainIdentityWrite } from "./identityWriteChain";
import { publishPersistedDocument, saveDocumentRecord } from "./persistence";
import { logRevalidationApplied as logApplied } from "./remoteRevalidationTelemetry";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
  SaveDocumentRecordOptions,
} from "./state";
import {
  discardPreRegisteredUpdateIds,
  discardUnacceptedPreRegisteredUpdateIds,
} from "./syncAcceptedUpdateIds";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { clearConsumedRemoteUpdateSignal } from "./syncRemoteSignals";
import {
  applyIncomingSyncedUpdates,
  documentSyncContextMatches,
  importSyncedDocumentUpdates,
} from "./syncUpdateImport";
import { extendDocumentVersionCoverage } from "./versionCoverage";

function documentWriterProjectionMatchesSyncResponse(
  writerProjection: NonNullable<
    DocumentSyncAttempt["synced"]["writerProjection"]
  >,
  synced: DocumentSyncAttempt["synced"],
): boolean {
  return (
    writerProjection.contentKeyBundle.contentKeyEpoch ===
      synced.response.contentKeyBundle.contentKeyEpoch &&
    writerProjection.contentKeyBundle.linkSetManifestHash ===
      synced.response.contentKeyBundle.linkSetManifestHash &&
    writerProjection.contentKeyBundle.targetHash ===
      synced.response.contentKeyBundle.targetHash &&
    writerProjection.documentKekTargets.linkSetManifestHash ===
      synced.response.documentKekTargets.linkSetManifestHash &&
    writerProjection.documentKekTargets.documentKeyTargetHash ===
      synced.response.documentKekTargets.documentKeyTargetHash
  );
}

function resolveSyncedDocumentWriterProjection(
  state: DocumentStoreState,
  synced: DocumentSyncAttempt["synced"],
) {
  const writerProjection =
    synced.writerProjection ??
    (state.writerProjection?.documentId === synced.plan.documentId
      ? state.writerProjection
      : null);
  return writerProjection &&
    documentWriterProjectionMatchesSyncResponse(writerProjection, synced)
    ? writerProjection
    : null;
}

/**
 * Durable-history tail: append pulled updates BEFORE the record persist so
 * the tail stays a superset of what the snapshot covers (duplicates are
 * idempotent by op identity; a crash between the writes can only leave the
 * safe superset).
 */
function pulledHistoryUpdates(synced: DocumentSyncAttempt["synced"]): string[] {
  return synced.decryptedUpdates.map((update) =>
    bytesToBase64(update.updateData),
  );
}

/**
 * The frontier a finalize persist may publish: the stored frontier advanced
 * by exactly the pulled updates just appended to the durable tail — never the
 * live document's version, which can transiently include an in-flight local
 * edit whose durable row has not landed yet.
 */
function coveredSyncFrontier(
  state: DocumentStoreState,
  currentRecord: DocumentRecord,
  synced: DocumentSyncAttempt["synced"],
): { snapshotEndVersion: string } | Record<string, never> {
  if (synced.decryptedUpdates.length === 0) {
    return {};
  }
  const liveFrontier = (state.record ?? currentRecord).snapshotEndVersion;
  return {
    snapshotEndVersion: mergeVersionVectors([
      ...(liveFrontier.length > 0 ? [liveFrontier] : []),
      ...synced.decryptedUpdates.map(
        (update) =>
          getImportBlobMetadata(update.updateData).partialEndVersionVector,
      ),
    ]),
  };
}

function documentSyncSaveOptions(
  syncAttempt: DocumentSyncAttempt,
): SaveDocumentRecordOptions {
  return {
    acceptedPendingUpdateIds: syncAttempt.synced.settledPendingUpdateIds,
    clearSyncFailure: shouldClearDocumentSyncFailureAfterPass(
      syncAttempt.synced,
      syncAttempt.outgoingUpdateCount,
    ),
    expectedSyncState: {
      pullContinuation: syncAttempt.consumedPullContinuation,
      record: syncAttempt.requestRecord,
    },
    historyUpdateOrigin: "remote",
    historyUpdates: pulledHistoryUpdates(syncAttempt.synced),
    preserveSnapshotStructuredFields: true,
    preserveSnapshotText: true,
  };
}

async function persistSyncedDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  generation: DocumentStoreSyncGeneration,
) {
  const { synced } = syncAttempt;
  const updates = synced.decryptedUpdates;
  const candidate = currentDoc.fork();
  const previousDocumentId = state.record?.documentId ?? null;
  const options = documentSyncSaveOptions(syncAttempt);
  const isCurrent = () =>
    isDocumentStoreSyncGenerationCurrent(state, generation);
  try {
    importSyncedDocumentUpdates(candidate, updates);
    if (state.pendingBaseVersion === null) {
      throw new Error("Document sync requires an initialized pending base");
    }
    const persisted = await saveDocumentRecord(
      state,
      candidate,
      {
        ...synced.persistedState,
        lastCommitLsn:
          synced.response.commitLsn ?? currentRecord.lastCommitLsn ?? null,
        pullContinuation: readPullContinuation(synced.response),
        ...coveredSyncFrontier(state, currentRecord, synced),
      },
      {
        ...options,
        pendingBaseVersionOverride: extendDocumentVersionCoverage({
          baseVersion: state.pendingBaseVersion,
          documentVersion: encodeVersionVector(candidate),
          spans: updates,
        }),
      },
      generation,
    );
    if (
      persisted &&
      isCurrent() &&
      !persisted.pullContinuationSuperseded &&
      !persisted.syncIdentitySuperseded
    ) {
      // Publish a remote edit only once its history and continuation commit.
      // Importing earlier lets a losing CAS expose text that the next local
      // write authors against an older, reloaded CRDT history.
      // The durable CAS already checked the request's complete context. The
      // successful row is now live, so publication uses that committed context
      // (which may contain refreshed keying metadata) and the same generation.
      applyIncomingSyncedUpdates(
        state,
        currentDoc,
        persisted.record,
        syncAttempt,
        generation,
      );
    }
    return await publishPersistedDocument(
      state,
      currentDoc,
      persisted,
      previousDocumentId,
      options,
      isCurrent,
    );
  } finally {
    candidate.free();
  }
}

export function shouldReArmDocumentSync(
  state: DocumentStoreState,
  syncAttempt: DocumentSyncAttempt,
): boolean {
  const { synced } = syncAttempt;
  const shouldReArmOutgoing = settleOutgoingPassAndDecideReArm(state, {
    exhaustedPendingUpdateCount: synced.exhaustedPendingUpdateCount,
    outgoingUpdateCount: syncAttempt.outgoingUpdateCount,
    rekeyedUpdateCount: synced.rekeyedPendingUpdateIds.length,
    settledUpdateCount: synced.settledPendingUpdateIds.length,
    acceptedRecoveryBaseline: synced.acceptedRecoveryBaseline,
  });
  return (
    synced.hasDeferredPendingUpdates ||
    synced.hasIncompletePull ||
    shouldReArmOutgoing
  );
}

export async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  consumedRemoteUpdateSignalSeq: number,
  generation: DocumentStoreSyncGeneration,
  sentUpdateIds: readonly string[],
  wasRemoteProbe: boolean,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return state.record ?? currentRecord;
  }

  // The sent IDs were pre-registered as self-authored before the network call so
  // the redis echo can never beat us. Reconcile against what the server actually
  // accepted: an ID we sent but the server did not accept will never be echoed,
  // so drop it to keep locallyAcceptedUpdateIds from leaking. Accepted IDs (a
  // subset of what we sent) stay registered until their echo consumes them.
  discardUnacceptedPreRegisteredUpdateIds(
    state,
    sentUpdateIds,
    synced.response.acceptedOutgoingUpdateIds,
  );
  // Persist on the identity-write chain: synced.persistedState carries this
  // pass's documentId, so it would clobber a relink that landed mid-pass. If
  // the identity moved, the response describes the OLD document — skip every
  // response-derived in-memory mutation and let the new identity's own sync
  // pass take over.
  let responseApplied = false;
  const { record: nextRecord } = await chainIdentityWrite(state, async () => {
    const liveRecord = state.record;
    if (
      !isDocumentStoreSyncGenerationCurrent(state, generation) ||
      !documentSyncContextMatches(
        liveRecord,
        currentRecord,
        synced.plan.documentId,
      )
    ) {
      return { record: liveRecord ?? currentRecord };
    }

    state.writerProjection = resolveSyncedDocumentWriterProjection(
      state,
      synced,
    );
    const persisted = await persistSyncedDocument(
      state,
      currentDoc,
      currentRecord,
      syncAttempt,
      generation,
    );
    if (
      !persisted ||
      !isDocumentStoreSyncGenerationCurrent(state, generation)
    ) {
      return { record: state.record ?? currentRecord };
    }

    state.pullContinuation = persisted.record.pullContinuation ?? null;
    if (persisted.pullContinuationSuperseded) {
      state.writerProjection = null;
    }
    // A CAS loss means neither this response's acknowledgements nor its
    // continuation were committed. Keep the pass unapplied so its signals and
    // accepted-id registrations cannot be cleared without a follow-up.
    responseApplied = !persisted.pullContinuationSuperseded;
    return persisted;
  });
  if (!responseApplied) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return nextRecord;
  }

  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return state.record ?? nextRecord;
  }

  // A bounded pull request owns the whole page chain. Completing the signal on
  // an intermediate page would let a failed/null continuation pass report the
  // original request as successful even though the server frontier was never
  // drained.
  if (!synced.hasIncompletePull) {
    clearConsumedRemoteUpdateSignal(state, consumedRemoteUpdateSignalSeq);
  }

  if (shouldReArmDocumentSync(state, syncAttempt)) {
    requestDocumentStoreSync(state);
  }

  await hydrateAttachmentBlobs(state, currentDoc, nextRecord, generation);
  logApplied(state, currentDoc, synced.decryptedUpdates.length, wasRemoteProbe);
  return nextRecord;
}
