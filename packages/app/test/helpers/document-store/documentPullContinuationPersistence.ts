import type {
  DocumentRecord,
  DocumentsPersistence,
} from "@symcrypt/client-sdk";

export function invalidateMemoryDocumentPullContinuation(
  document: DocumentRecord | null,
  input: Parameters<DocumentsPersistence["invalidatePullContinuation"]>[1],
): DocumentRecord | null {
  if (!document) return null;
  const continuation = document.pullContinuation;
  const matches =
    document.id === input.localId &&
    document.documentId === input.documentId &&
    document.accessEpoch === input.accessEpoch &&
    (document.accessStateHash ?? null) === input.accessStateHash &&
    (document.contentKeyBundle ?? null) === input.contentKeyBundle &&
    (document.documentKekTargets ?? null) === input.documentKekTargets &&
    (document.documentManifestBundle ?? null) ===
      input.documentManifestBundle &&
    (document.lastCommitLsn ?? null) === input.lastCommitLsn &&
    continuation?.commitLsn === input.continuation.commitLsn &&
    continuation.commitLsnMode === input.continuation.commitLsnMode &&
    continuation.cursor === input.continuation.cursor;
  if (!matches) return document;

  const { pullContinuation: _rejected, ...current } = document;
  return {
    ...current,
    pullContinuationRecoveryRequired: true,
  };
}

export function createMemoryPullContinuationPersistence(
  state: {
    document: DocumentRecord | null;
  },
  loadHistoryRestoreState: DocumentsPersistence["loadHistoryRestoreState"],
): Pick<DocumentsPersistence, "invalidatePullContinuation"> {
  return {
    async invalidatePullContinuation(execSql, input) {
      state.document = invalidateMemoryDocumentPullContinuation(
        state.document,
        input,
      );
      if (!state.document) return null;
      return {
        historyRestoreState: await loadHistoryRestoreState(
          execSql,
          input.localId,
        ),
        record: state.document,
      };
    },
  };
}
