import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
  versionVectorsEqual,
} from "@symcrypt/loro";
import { readPullContinuation } from "../../../data/documents/shared/syncPagination";
import {
  createDocumentWriterPublicKeyResolver,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { requestDocumentStoreSync } from "../registry";
import { importPendingUpdates, installRebuiltDocument } from "./historyRebuild";
import {
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
} from "./persistence";
import type { DocumentStoreState } from "./state";
import { createStoredDocument } from "./storedDocument";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  discardUnacceptedPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { documentTerminalSubmitFailureHandler } from "./syncShared";
import { importSyncedDocumentUpdates } from "./syncUpdateImport";

export function shouldRequestRotationRecoverySync(input: {
  readonly hasDeferredPendingUpdates: boolean;
  readonly hasIncompletePull: boolean;
}): boolean {
  return input.hasDeferredPendingUpdates || input.hasIncompletePull;
}

function assertRotationRecoveryPrerequisites(state: DocumentStoreState) {
  const author = resolveDocumentCreateAuthor(state.runtime);
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  const documentId = state.record?.documentId;
  if (
    !author ||
    !encapsulationKeyPair ||
    !documentId ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    throw new Error(
      "Rotation requires verified full-history recovery, but remote sync prerequisites are unavailable",
    );
  }
  return { author, documentId, encapsulationKeyPair };
}

async function pullVerifiedHistoryForRotation(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
  localVersionVector: string | null;
  pendingUpdates: Awaited<ReturnType<typeof listPendingUpdates>>;
  state: DocumentStoreState;
}) {
  const { author, documentId, encapsulationKeyPair } =
    assertRotationRecoveryPrerequisites(input.state);
  const sentUpdateIds: string[] = [];

  let abandonReason: string | null = null;
  const synced = await cleanupPreRegisteredUpdateIdsOnFailure(
    input.state,
    sentUpdateIds,
    () =>
      syncRemoteDocument({
        apiClient: input.state.runtime.apiClient,
        author,
        // The recovery pull can meet a stale content-key bundle too; heal it
        // from the live document's full history like the ordinary sync lane
        // does, instead of aborting the rotation preflight.
        buildRotationSnapshot: async () => {
          const currentDoc = input.state.doc;
          return currentDoc ? exportFullHistorySnapshot(currentDoc) : null;
        },
        documentId,
        execSql: input.state.runtime.infra.execSql,
        isRemoteSyncBlocked: input.state.runtime.util.isRemoteSyncBlocked,
        localVersionVector: input.localVersionVector,
        minLsn: input.currentRecord.lastCommitLsn ?? undefined,
        onSyncAbandoned: (reason) => {
          abandonReason = reason;
        },
        onSyncTrace: (line) =>
          input.state.runtime.util.log(`Documents: ${line}`),
        onOutgoingUpdatesMaterialized: (updateIds) =>
          preRegisterMaterializedDocumentSyncUpdateIds(
            input.state,
            sentUpdateIds,
            updateIds,
          ),
        onPullContinuationInvalidated: () => {
          if (
            isDocumentStoreSyncGenerationCurrent(input.state, input.generation)
          ) {
            input.state.pullContinuation = null;
          }
        },
        onTerminalSubmitFailure: documentTerminalSubmitFailureHandler(
          input.state,
          input.generation,
        ),
        pendingUpdates: input.pendingUpdates,
        persistedState: input.currentRecord,
        pullContinuation: input.state.pullContinuation ?? undefined,
        rekeyPendingUpdate: input.state.persistence.rekeyPendingUpdate,
        resolveProjectionUserKey: input.state.resolveProjectionUserKey,
        resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
          logPrefix: "Documents",
          runtime: input.state.runtime,
          writerKeyLabel: "writer key",
        }),
        targetSecretKey: encapsulationKeyPair.secretKey,
        warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
          input.state.runtime,
        ),
        writerProjection:
          input.state.writerProjection?.documentId === documentId
            ? input.state.writerProjection
            : undefined,
      }),
  );
  if (!synced) {
    discardPreRegisteredUpdateIds(input.state, sentUpdateIds);
    throw new Error(
      `Rotation full-history recovery could not complete (${abandonReason ?? "sync did not finish"}); key rotation was not started`,
    );
  }
  discardUnacceptedPreRegisteredUpdateIds(
    input.state,
    sentUpdateIds,
    synced.response.acceptedOutgoingUpdateIds,
  );
  return synced;
}

async function recoverFullHistoryForRotation(
  state: DocumentStoreState,
): Promise<Uint8Array> {
  const currentDoc = state.doc;
  const currentRecord = state.record;
  if (!currentDoc || !currentRecord) {
    throw new Error(
      "Document must finish loading before its content key can rotate",
    );
  }
  // The teardown guard for the recovery's terminal-failure handler: captured
  // before the pull so a discard (row 21) racing this preflight invalidates
  // it, and the stale handler cannot resurrect a deleted failure row.
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    throw new Error(
      "Document changed during rotation recovery; retry key rotation",
    );
  }

  const capturedVersion = encodeVersionVector(currentDoc);
  const uncoveredLocalDelta = pendingDeltaSinceBase(state, currentDoc);
  const pendingUpdates = await listPendingUpdates(state);
  const localFullHistorySnapshot = exportFullHistorySnapshot(currentDoc);

  // Always perform a verified pull. Another writer may have advanced the
  // remote frontier since our last sync; submitting the clean but stale local
  // snapshot would otherwise fail the atomic coverage check on every retry.
  // The local full history seeds the rebuild, so request only the missing
  // tail beyond the captured version.
  const synced = await pullVerifiedHistoryForRotation({
    currentRecord,
    generation,
    localVersionVector: capturedVersion,
    pendingUpdates,
    state,
  });

  try {
    // Do not replace or persist over a document that changed while the
    // verified pull was in flight. A retry can recover the newer frontier
    // safely.
    if (
      state.doc !== currentDoc ||
      !versionVectorsEqual(encodeVersionVector(currentDoc), capturedVersion)
    ) {
      throw new Error(
        "Document changed during rotation recovery; retry key rotation",
      );
    }

    const rebuiltDoc = await createStoredDocument(state);
    importSnapshot(rebuiltDoc, localFullHistorySnapshot);
    importSyncedDocumentUpdates(rebuiltDoc, synced.decryptedUpdates);
    // A successful write pull normally echoes accepted local updates, but
    // merge the durable queue too so recovery does not depend on that
    // response detail.
    importPendingUpdates(rebuiltDoc, pendingUpdates);
    if (uncoveredLocalDelta.byteLength > 0) {
      importUpdates(rebuiltDoc, [uncoveredLocalDelta]);
      // `pendingBaseVersion` can intentionally lag a deferred or interrupted
      // local write. Make that uncovered delta durable before advancing it.
      await enqueuePendingUpdate(state, uncoveredLocalDelta);
    }

    const fullHistorySnapshot = await installRebuiltDocument({
      currentRecord,
      rebuiltDoc,
      state,
      synced,
    });
    state.pullContinuation = readPullContinuation(synced.response);
    if (synced.hasIncompletePull) {
      throw new Error(
        "Rotation full-history recovery persisted a partial pull; retry after sync completes",
      );
    }
    return fullHistorySnapshot;
  } finally {
    // Durable progress that left queued work needs a follow-up lane pass; the
    // rotation that follows may abort before syncing again. Terminal recovery
    // exhaustion and no-progress responses deliberately do not self-arm.
    // Request the follow-up only AFTER the rebuild/install window has closed —
    // scheduling it mid-window deterministically raced the lane's import
    // against the version check above and the rebuilt-document install.
    if (shouldRequestRotationRecoverySync(synced)) {
      requestDocumentStoreSync(state);
    }
  }
}

/**
 * Serialize rotation recovery behind local writes. New writes enqueue behind
 * this promise, so the reconstructed document is installed before they mutate
 * it. This is a preflight, not an atomic link-set/rotation transaction.
 */
export function assertDocumentStoreCanRotateContentKey(
  state: DocumentStoreState,
): Promise<Uint8Array> {
  const recovery = state.writeChain
    .catch(() => undefined)
    .then(() => recoverFullHistoryForRotation(state));
  // The returned promise reports the preflight failure to its caller. Keep the
  // internal serialization tail fulfilled so the same rejection is not also
  // emitted as an unhandled promise and later writes/rotation retries can run.
  state.writeChain = recovery.then(
    () => undefined,
    () => undefined,
  );
  return recovery;
}
