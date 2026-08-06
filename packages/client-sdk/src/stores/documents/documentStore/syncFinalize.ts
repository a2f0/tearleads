import { bytesToBase64 } from "@tearleads/encoding";
import { getImportBlobMetadata, mergeVersionVectors } from "@tearleads/loro";
import {
  type DocumentRecord,
  settleOutgoingPassAndDecideReArm,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import { chainIdentityWrite } from "./identityWriteChain";
import { persistDocument } from "./persistence";
import { logRevalidationApplied as logApplied } from "./remoteRevalidationTelemetry";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
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
} from "./syncUpdateImport";

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
async function appendPulledUpdatesToHistory(
  state: DocumentStoreState,
  synced: DocumentSyncAttempt["synced"],
): Promise<void> {
  if (synced.decryptedUpdates.length === 0) {
    return;
  }
  await state.persistence.appendHistoryUpdates(state.runtime.infra.execSql, {
    localId: state.localId,
    origin: "remote",
    updates: synced.decryptedUpdates.map((update) =>
      bytesToBase64(update.updateData),
    ),
  });
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

  let mergedDoc = currentDoc;
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

    mergedDoc = applyIncomingSyncedUpdates(
      state,
      currentDoc,
      currentRecord,
      syncAttempt,
      generation,
    );
    await appendPulledUpdatesToHistory(state, synced);
    state.writerProjection = resolveSyncedDocumentWriterProjection(
      state,
      synced,
    );
    const persisted = await persistDocument(
      state,
      mergedDoc,
      {
        ...synced.persistedState,
        lastCommitLsn:
          synced.response.commitLsn ?? currentRecord.lastCommitLsn ?? null,
        ...coveredSyncFrontier(state, currentRecord, synced),
      },
      {
        acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
        // This is a BACKGROUND metadata persist (commit LSN, accepted-update
        // bookkeeping), not a content change: any genuinely-new remote text was
        // already folded into the snapshot by applyIncomingSyncedUpdates inside
        // this serialized identity guard.
        // Re-deriving text/structured fields from the doc here is exactly what
        // let a sync pass republish a stale CRDT read over an in-flight
        // optimistic keystroke — regressing the controlled editor value and
        // jumping the caret. Preserve the live snapshot so the latest keystroke
        // always wins.
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
      },
      generation,
    );
    if (
      !persisted ||
      !isDocumentStoreSyncGenerationCurrent(state, generation)
    ) {
      return { record: state.record ?? currentRecord };
    }

    responseApplied = true;
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

  clearConsumedRemoteUpdateSignal(state, consumedRemoteUpdateSignalSeq);

  if (
    settleOutgoingPassAndDecideReArm(state, {
      outgoingUpdateCount: syncAttempt.outgoingUpdateCount,
      rekeyedUpdateCount: synced.rekeyedPendingUpdateIds.length,
      settledUpdateCount: synced.settledPendingUpdateIds.length,
    })
  ) {
    requestDocumentStoreSync(state);
  }

  await hydrateAttachmentBlobs(state, mergedDoc, nextRecord, generation);
  logApplied(state, mergedDoc, synced.decryptedUpdates.length, wasRemoteProbe);
  return nextRecord;
}
