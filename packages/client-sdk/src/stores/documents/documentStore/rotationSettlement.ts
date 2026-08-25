import { encodeVersionVector, satisfiesVersionVector } from "@symcrypt/loro";
import type { PendingUpdateRecord } from "../../../workflows/documents";
import { listPendingUpdates, persistDocument } from "./persistence";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
} from "./state";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardUnacceptedPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { requestRemoteDocumentSync } from "./syncRequest";

function ordinaryPendingUpdates(
  pendingUpdates: PendingUpdateRecord[],
): PendingUpdateRecord[] {
  return pendingUpdates.filter(
    (pendingUpdate) => pendingUpdate.sourceVersionVector == null,
  );
}

function pendingUpdateSetKey(pendingUpdates: readonly PendingUpdateRecord[]) {
  return pendingUpdates
    .map((pendingUpdate) => pendingUpdate.id)
    .sort()
    .join("\n");
}

async function persistStagedSettlement(input: {
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  preparedRecord: NonNullable<DocumentStoreState["record"]>;
  sentUpdateIds: string[];
  state: DocumentStoreState;
  syncAttempt: DocumentSyncAttempt;
}): Promise<void> {
  const { state, syncAttempt } = input;
  discardUnacceptedPreRegisteredUpdateIds(
    state,
    input.sentUpdateIds,
    syncAttempt.synced.response.acceptedOutgoingUpdateIds,
  );
  const persisted = await persistDocument(
    state,
    input.currentDocument,
    {
      lastCommitLsn:
        syncAttempt.synced.response.commitLsn ??
        input.preparedRecord.lastCommitLsn ??
        null,
    },
    {
      acceptedPendingUpdateIds: syncAttempt.synced.settledPendingUpdateIds,
      expectedSyncState: {
        pullContinuation: syncAttempt.consumedPullContinuation,
        record: syncAttempt.requestRecord,
      },
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    input.generation,
  );
  if (
    !persisted ||
    persisted.pullContinuationSuperseded ||
    persisted.syncIdentitySuperseded ||
    !isDocumentStoreSyncGenerationCurrent(state, input.generation)
  ) {
    throw new Error(
      "Document changed while local updates were settling for key rotation",
    );
  }
}

async function settleOrdinaryUpdatePass(input: {
  pendingUpdates: PendingUpdateRecord[];
  state: DocumentStoreState;
}): Promise<void> {
  const { state } = input;
  const currentDoc = state.doc;
  const currentRecord = state.record;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  if (!currentDoc || !currentRecord || !encapsulationKeyPair) {
    throw new Error(
      "Document changed while local updates were settling for key rotation",
    );
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    throw new Error(
      "Document changed while local updates were settling for key rotation",
    );
  }
  const prepared = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates: input.pendingUpdates,
    state,
  });
  if (!prepared || !isDocumentStoreSyncGenerationCurrent(state, generation)) {
    throw new Error(
      "Document changed while local updates were settling for key rotation",
    );
  }
  const pendingUpdates = ordinaryPendingUpdates(prepared.pendingUpdates);
  if (pendingUpdates.length === 0) return;

  const sentUpdateIds: string[] = [];
  await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    sentUpdateIds,
    async () => {
      const syncAttempt = await requestRemoteDocumentSync({
        allowRecoveryBaseline: false,
        currentDoc,
        currentRecord: prepared.record,
        encapsulationKeyPair,
        generation,
        onOutgoingUpdatesMaterialized: (updateIds) =>
          preRegisterMaterializedDocumentSyncUpdateIds(
            state,
            sentUpdateIds,
            updateIds,
          ),
        pendingUpdates,
        queuedUpdateCount: pendingUpdates.length,
        state,
        unavailableWriterLogMessage:
          "Documents: rotation could not settle local updates because the writer context is unavailable.",
      });
      if (
        !syncAttempt ||
        !isDocumentStoreSyncGenerationCurrent(state, generation)
      ) {
        throw new Error(
          "Document local updates could not be committed before key rotation",
        );
      }

      await persistStagedSettlement({
        currentDocument: currentDoc,
        generation,
        preparedRecord: prepared.record,
        sentUpdateIds,
        state,
        syncAttempt,
      });
    },
  );
}

/**
 * Commit only ordinary local rows before rotation. Server-returned updates are
 * authenticated and decrypted by the workflow but deliberately not imported
 * or persisted; the subsequent raw rebuild owns that all-or-nothing install.
 */
export async function settleOrdinaryDocumentUpdatesBeforeRotation(
  state: DocumentStoreState,
): Promise<void> {
  const stalledQueueStates = new Set<string>();

  while (true) {
    const currentDoc = state.doc;
    const pendingBaseVersion = state.pendingBaseVersion;
    if (!currentDoc || pendingBaseVersion === null) {
      throw new Error("Document rotation requires an initialized pending base");
    }
    const pendingUpdates = ordinaryPendingUpdates(
      await listPendingUpdates(state),
    );
    if (
      pendingUpdates.length === 0 &&
      satisfiesVersionVector(
        pendingBaseVersion,
        encodeVersionVector(currentDoc),
      )
    ) {
      return;
    }

    const queueState = `${pendingBaseVersion}\n${pendingUpdateSetKey(pendingUpdates)}`;
    if (stalledQueueStates.has(queueState)) {
      throw new Error(
        "Document local updates could not be committed before key rotation",
      );
    }
    stalledQueueStates.add(queueState);
    await settleOrdinaryUpdatePass({ pendingUpdates, state });
  }
}
