import {
  encodeVersionVector,
  importUpdates,
  versionVectorsEqual,
} from "@symcrypt/loro";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentSyncPullContinuation,
  readPullContinuation,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { requestDocumentStoreSync } from "../registry";
import {
  importPendingOrdinaryUpdates,
  installRebuiltDocument,
} from "./historyRebuild";
import { rebaseDocumentAfterPendingUpdateRefusal } from "./pendingUpdateRefusal";
import {
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
} from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";
import { createStoredDocument } from "./storedDocument";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
} from "./syncGeneration";
import { documentIncomingUpdateIsolationFailureHandler } from "./syncShared";
import { importSyncedDocumentUpdates } from "./syncUpdateImport";

function ordinaryRawHistoryUpdates<T extends { checkpointKind?: string }>(
  updates: readonly T[],
): T[] {
  return updates.filter((update) => update.checkpointKind === undefined);
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

function rotationIncomingUpdateIsolation(input: {
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}) {
  return {
    onIncomingUpdateIsolationFailure:
      documentIncomingUpdateIsolationFailureHandler(
        input.state,
        input.generation,
      ),
    validateIncomingUpdates: async (
      result: Pick<
        NonNullable<Awaited<ReturnType<typeof syncRemoteDocument>>>,
        "decryptedUpdates" | "response"
      >,
    ) => {
      await validateDocumentSyncUpdateImports({
        currentDocument: input.currentDocument,
        decryptedUpdates: result.decryptedUpdates,
        responseUpdates: result.response.updates,
      });
      const decryptedUpdates = ordinaryRawHistoryUpdates(
        result.decryptedUpdates,
      );
      const ordinaryUpdateIds = new Set(
        decryptedUpdates.map((update) => update.id),
      );
      await validateDocumentSyncUpdateImports({
        currentDocument: input.currentDocument,
        decryptedUpdates,
        responseUpdates: result.response.updates.filter((update) =>
          ordinaryUpdateIds.has(update.id),
        ),
      });
    },
  };
}

async function pullVerifiedRawHistoryForRotation(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
  rebuiltDocument: DocumentState;
  state: DocumentStoreState;
}) {
  const { author, documentId, encapsulationKeyPair } =
    assertRotationRecoveryPrerequisites(input.state);
  let pullContinuation: DocumentSyncPullContinuation | undefined;
  let writerProjection =
    input.state.writerProjection?.documentId === documentId
      ? input.state.writerProjection
      : undefined;

  while (true) {
    let abandonReason: string | null = null;
    const synced = await syncRemoteDocument({
      apiClient: input.state.runtime.apiClient,
      author,
      documentId,
      execSql: input.state.runtime.infra.execSql,
      historyMode: "raw",
      isRemoteSyncBlocked: input.state.runtime.util.isRemoteSyncBlocked,
      localVersionVector: null,
      minLsn: input.currentRecord.lastCommitLsn ?? undefined,
      onSyncAbandoned: (reason) => {
        abandonReason = reason;
      },
      ...rotationIncomingUpdateIsolation({
        currentDocument: input.rebuiltDocument,
        generation: input.generation,
        state: input.state,
      }),
      onSyncTrace: (line) => input.state.runtime.util.log(`Documents: ${line}`),
      pendingUpdates: [],
      pullContinuation,
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
      writerProjection,
    });
    if (!synced) {
      throw new Error(
        `Rotation raw-history recovery could not complete (${abandonReason ?? "sync did not finish"}); key rotation was not started`,
      );
    }

    importSyncedDocumentUpdates(
      input.rebuiltDocument,
      ordinaryRawHistoryUpdates(synced.decryptedUpdates),
    );
    if (!synced.hasIncompletePull) return synced;

    const nextContinuation = readPullContinuation(synced.response);
    if (!nextContinuation) {
      throw new Error(
        "Rotation raw-history recovery ended before the retained history was complete",
      );
    }
    pullContinuation = nextContinuation;
    writerProjection = synced.writerProjection;
  }
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
  const consumedPullContinuation = state.pullContinuation;
  let settlementRequiresRetry = false;

  // A raw recovery starts from an empty scratch document, bypasses untrusted
  // rotation-baseline redirects, drains every retained page in memory, and
  // publishes nothing until all response updates have validated. Checkpoints
  // are authenticated and decrypted but are not reconstruction inputs: the
  // original ordinary update stream is the source of truth in this mode.
  const rebuiltDoc = await createStoredDocument(state);

  try {
    const synced = await pullVerifiedRawHistoryForRotation({
      currentRecord,
      generation,
      rebuiltDocument: rebuiltDoc,
      state,
    });

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

    // Raw recovery is read-only, so durable local queue rows remain queued.
    // Merge ordinary local deltas, but never trust queued rotation snapshots:
    // their coverage claims are excluded for the same reason as remote
    // rotate_baseline checkpoints.
    importPendingOrdinaryUpdates(rebuiltDoc, pendingUpdates);
    if (uncoveredLocalDelta.byteLength > 0) {
      importUpdates(rebuiltDoc, [uncoveredLocalDelta]);
      // `pendingBaseVersion` can intentionally lag a deferred or interrupted
      // local write. Make that uncovered delta durable before advancing it.
      const enqueued = await enqueuePendingUpdate(
        state,
        uncoveredLocalDelta,
        undefined,
        generation,
      );
      if (!enqueued) {
        await rebaseDocumentAfterPendingUpdateRefusal(state, generation);
        throw new Error(
          "Document identity changed during rotation recovery; retry key rotation",
        );
      }
    }

    const installed = await installRebuiltDocument({
      consumedPullContinuation,
      currentRecord,
      rebuiltDoc,
      state,
      synced,
    });
    settlementRequiresRetry = installed.settlementRequiresRetry;
    if (settlementRequiresRetry) {
      throw new Error(
        "Rotation raw-history recovery was superseded during its atomic install; retry key rotation",
      );
    }
    return installed.fullHistorySnapshot;
  } finally {
    // Failed or superseded scratch documents never transfer to the store and
    // must release their WASM allocation. A successfully installed document
    // is now store-owned and remains live.
    if (state.doc !== rebuiltDoc) {
      rebuiltDoc.free();
    }
    // A superseding pane left work for the ordinary lane. Existing pending
    // rows were already armed when enqueued; do not start their old-boundary
    // sync in the narrow window before the caller submits its rotation.
    if (settlementRequiresRetry) {
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
