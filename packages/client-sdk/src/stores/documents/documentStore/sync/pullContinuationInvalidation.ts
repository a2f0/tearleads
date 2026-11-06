import {
  type DocumentRecord,
  type DocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
  runSerializedSqlMutation,
} from "../../../../workflows/documents";
import { importDurableDocumentHistory } from "../history/durableDocumentReload";
import { type DocumentStoreState, setReadySnapshot } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { documentSyncContextMatches } from "./syncUpdateImport";

/** The sync context the invalidation requires the stored record to keep. */
function expectedSyncContext(record: DocumentRecord) {
  return {
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
  };
}

export async function invalidateDocumentStorePullContinuation(input: {
  continuation: DocumentSyncPullContinuation;
  currentRecord: DocumentRecord;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): Promise<void> {
  const { continuation, currentRecord, generation, state } = input;
  const documentId = currentRecord.documentId;
  const liveDoc = generation.currentDoc;
  if (
    !documentId ||
    !liveDoc ||
    !isDocumentStoreSyncGenerationCurrent(state, generation)
  ) {
    return;
  }

  await runSerializedSqlMutation(generation.execSql, async (lockedExecSql) => {
    const invalidated = await state.persistence.invalidatePullContinuation(
      lockedExecSql,
      {
        ...expectedSyncContext(currentRecord),
        continuation,
        documentId,
        localId: currentRecord.id,
      },
    );
    if (!invalidated) return;
    const { historyRestoreState, record: durableRecord } = invalidated;
    const canAdoptDurableRecord = () =>
      isDocumentStoreSyncGenerationCurrent(state, generation) &&
      documentSyncContextMatches(state.record, currentRecord, documentId) &&
      durableRecord.id === currentRecord.id &&
      durableRecord.documentId === documentId &&
      durableRecord.accessEpoch === currentRecord.accessEpoch &&
      (durableRecord.accessStateHash ?? null) ===
        (currentRecord.accessStateHash ?? null) &&
      (durableRecord.contentKeyBundle ?? null) ===
        (currentRecord.contentKeyBundle ?? null) &&
      (durableRecord.documentKekTargets ?? null) ===
        (currentRecord.documentKekTargets ?? null) &&
      (durableRecord.documentManifestBundle ?? null) ===
        (currentRecord.documentManifestBundle ?? null) &&
      documentSyncPullContinuationsEqual(state.pullContinuation, continuation);
    if (!canAdoptDurableRecord()) return;
    importDurableDocumentHistory(liveDoc, historyRestoreState);
    if (!canAdoptDurableRecord()) {
      return;
    }
    const {
      pullContinuation: _stalePullContinuation,
      pullContinuationRecoveryRequired: _staleRecoveryMarker,
      ...liveRecord
    } = state.record ?? currentRecord;
    state.record = { ...liveRecord, ...durableRecord };
    state.pullContinuation = durableRecord.pullContinuation ?? null;
    state.pendingBaseVersion =
      durableRecord.pendingBaseVersion ?? durableRecord.snapshotEndVersion;
    const preserveOptimisticProjection = state.pendingLocalWrites > 0;
    setReadySnapshot(
      state,
      liveDoc,
      state.snapshot.syncing,
      preserveOptimisticProjection ? state.snapshot.text : undefined,
      preserveOptimisticProjection
        ? state.snapshot.structuredFields
        : undefined,
    );
  });
}
