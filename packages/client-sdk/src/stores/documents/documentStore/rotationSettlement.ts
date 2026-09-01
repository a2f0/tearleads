import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import type { PendingUpdateRecord } from "../../../workflows/documents";
import { chainIdentityWrite } from "./identityWriteChain";
import { listPendingUpdates, persistDocument } from "./persistence";
import { invalidateDocumentStorePullContinuation } from "./pullContinuationInvalidation";
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
import { extendDocumentVersionCoverage } from "./versionCoverage";

function ordinaryPendingUpdates(
  pendingUpdates: readonly PendingUpdateRecord[],
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

function pendingUpdateMatchesProvenRow(
  pendingUpdate: PendingUpdateRecord,
  provenUpdate: PendingUpdateRecord,
): boolean {
  return (
    pendingUpdate.id === provenUpdate.id &&
    pendingUpdate.updateData === provenUpdate.updateData &&
    pendingUpdate.partialStartVersionVector ===
      provenUpdate.partialStartVersionVector &&
    pendingUpdate.partialEndVersionVector ===
      provenUpdate.partialEndVersionVector &&
    pendingUpdate.sourceVersionVector === provenUpdate.sourceVersionVector
  );
}

function assertOrdinaryRowsWereProven(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  provenUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
}): void {
  for (const pendingUpdate of ordinaryPendingUpdates(input.pendingUpdates)) {
    const provenUpdate = input.provenUpdatesById.get(pendingUpdate.id);
    if (
      !provenUpdate ||
      !pendingUpdateMatchesProvenRow(pendingUpdate, provenUpdate)
    ) {
      throw new Error(
        "Document local updates changed after rotation provenance verification",
      );
    }
  }
}

function ordinaryPendingUpdatesWithProvenCoverage(input: {
  currentDocument: DocumentState;
  pendingUpdates: PendingUpdateRecord[];
  verifiedBaseVersion: string;
}): { coverage: string; pendingUpdates: PendingUpdateRecord[] } {
  const ordinaryUpdates = ordinaryPendingUpdates(input.pendingUpdates);
  const documentVersion = encodeVersionVector(input.currentDocument);
  const ordinaryCoverage = extendDocumentVersionCoverage({
    baseVersion: input.verifiedBaseVersion,
    documentVersion,
    spans: ordinaryUpdates,
  });
  if (!satisfiesVersionVector(ordinaryCoverage, documentVersion)) {
    throw new Error(
      "Document rotation cannot settle uncovered local history because it may be checkpoint-derived",
    );
  }
  return { coverage: ordinaryCoverage, pendingUpdates: ordinaryUpdates };
}

export async function invalidatePullContinuationBeforeRotation(
  state: DocumentStoreState,
): Promise<void> {
  const continuation = state.pullContinuation;
  if (!continuation) return;
  const currentDoc = state.doc;
  const currentRecord = state.record;
  if (!currentDoc || !currentRecord) {
    throw new Error(
      "Document changed while its pull continuation was invalidated for key rotation",
    );
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    throw new Error(
      "Document changed while its pull continuation was invalidated for key rotation",
    );
  }
  await invalidateDocumentStorePullContinuation({
    continuation,
    currentRecord,
    generation,
    state,
  });
  if (
    state.pullContinuation !== null ||
    !isDocumentStoreSyncGenerationCurrent(state, generation)
  ) {
    throw new Error(
      "Document pull continuation could not be invalidated before key rotation",
    );
  }
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
      pullContinuation: null,
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

function settledOrdinaryCoverage(input: {
  currentDocument: DocumentState;
  pendingUpdates: PendingUpdateRecord[];
  settledUpdateIds: readonly string[];
  verifiedBaseVersion: string;
}): string {
  const settled = new Set(input.settledUpdateIds);
  return extendDocumentVersionCoverage({
    baseVersion: input.verifiedBaseVersion,
    documentVersion: encodeVersionVector(input.currentDocument),
    spans: input.pendingUpdates.filter((update) => settled.has(update.id)),
  });
}

async function persistStagedSettlementOnIdentityChain(input: {
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  pendingUpdates: PendingUpdateRecord[];
  preparedRecord: NonNullable<DocumentStoreState["record"]>;
  sentUpdateIds: string[];
  state: DocumentStoreState;
  syncAttempt: DocumentSyncAttempt;
  verifiedBaseVersion: string;
}): Promise<string> {
  return chainIdentityWrite(input.state, async () => {
    if (!isDocumentStoreSyncGenerationCurrent(input.state, input.generation)) {
      throw new Error(
        "Document changed while local updates were settling for key rotation",
      );
    }
    await persistStagedSettlement(input);
    return settledOrdinaryCoverage({
      currentDocument: input.currentDocument,
      pendingUpdates: input.pendingUpdates,
      settledUpdateIds: input.syncAttempt.synced.settledPendingUpdateIds,
      verifiedBaseVersion: input.verifiedBaseVersion,
    });
  });
}

async function settleOrdinaryUpdatePass(input: {
  pendingUpdates: PendingUpdateRecord[];
  state: DocumentStoreState;
  verifiedBaseVersion: string;
}): Promise<string> {
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
  const proven = ordinaryPendingUpdatesWithProvenCoverage({
    currentDocument: currentDoc,
    pendingUpdates: input.pendingUpdates,
    verifiedBaseVersion: input.verifiedBaseVersion,
  });
  const prepared = await prepareDocumentOutgoingCoverage({
    coverageBaseVersion: input.verifiedBaseVersion,
    currentDoc,
    generation,
    pendingUpdates: proven.pendingUpdates,
    state,
  });
  if (!prepared || !isDocumentStoreSyncGenerationCurrent(state, generation)) {
    throw new Error(
      "Document changed while local updates were settling for key rotation",
    );
  }
  const preparedPendingUpdates = ordinaryPendingUpdates(
    prepared.pendingUpdates,
  );
  if (preparedPendingUpdates.length === 0) return proven.coverage;

  const sentUpdateIds: string[] = [];
  return cleanupPreRegisteredUpdateIdsOnFailure(
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
        pendingUpdates: preparedPendingUpdates,
        queuedUpdateCount: preparedPendingUpdates.length,
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

      return persistStagedSettlementOnIdentityChain({
        currentDocument: currentDoc,
        generation,
        pendingUpdates: preparedPendingUpdates,
        preparedRecord: prepared.record,
        sentUpdateIds,
        state,
        syncAttempt,
        verifiedBaseVersion: input.verifiedBaseVersion,
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
  verifiedBaseVersion: string,
  provenPendingUpdates: readonly PendingUpdateRecord[],
): Promise<void> {
  const stalledQueueStates = new Set<string>();
  let verifiedCoverage = verifiedBaseVersion;
  const provenUpdatesById = new Map(
    ordinaryPendingUpdates(provenPendingUpdates).map((update) => [
      update.id,
      update,
    ]),
  );

  while (true) {
    const currentDoc = state.doc;
    if (!currentDoc) {
      throw new Error("Document rotation requires an initialized document");
    }
    const allPendingUpdates = await listPendingUpdates(state);
    assertOrdinaryRowsWereProven({
      pendingUpdates: allPendingUpdates,
      provenUpdatesById,
    });
    const pendingUpdates = ordinaryPendingUpdates(allPendingUpdates);
    if (
      pendingUpdates.length === 0 &&
      satisfiesVersionVector(verifiedCoverage, encodeVersionVector(currentDoc))
    ) {
      return;
    }

    const queueState = `${verifiedCoverage}\n${pendingUpdateSetKey(pendingUpdates)}`;
    if (stalledQueueStates.has(queueState)) {
      throw new Error(
        "Document local updates could not be committed before key rotation",
      );
    }
    stalledQueueStates.add(queueState);
    verifiedCoverage = await settleOrdinaryUpdatePass({
      pendingUpdates: allPendingUpdates,
      state,
      verifiedBaseVersion: verifiedCoverage,
    });
  }
}
