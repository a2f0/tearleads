import {
  encodeVersionVector,
  satisfiesVersionVector,
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
import { installRebuiltDocument } from "./historyRebuild";
import { settleOrdinaryDocumentUpdatesBeforeRotation } from "./rotationSettlement";
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
      persistedState: input.currentRecord,
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
  assertRotationRecoveryPrerequisites(state);
  await settleOrdinaryDocumentUpdatesBeforeRotation(state);
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

    if (
      state.doc !== currentDoc ||
      !versionVectorsEqual(encodeVersionVector(currentDoc), capturedVersion)
    ) {
      throw new Error(
        "Document changed during rotation recovery; retry key rotation",
      );
    }
    if (
      !satisfiesVersionVector(encodeVersionVector(rebuiltDoc), capturedVersion)
    ) {
      // The missing ops have no remaining ordinary pending-row provenance.
      // They may have arrived through a forged checkpoint, so never launder
      // them into the ordinary stream or a new rotation baseline.
      throw new Error(
        "Rotation raw-history recovery found unverified local history; key rotation was not started",
      );
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
    if (state.doc !== rebuiltDoc) {
      rebuiltDoc.free();
    }
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
