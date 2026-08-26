import { encodeVersionVector, versionVectorsEqual } from "@symcrypt/loro";
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
import { chainIdentityWrite } from "./identityWriteChain";
import { listPendingUpdates } from "./persistence";
import {
  assertExactDocumentHistory,
  importProvenOrdinaryPendingHistory,
} from "./rotationProvenance";
import {
  invalidatePullContinuationBeforeRotation,
  settleOrdinaryDocumentUpdatesBeforeRotation,
} from "./rotationSettlement";
import type { DocumentState, DocumentStoreState } from "./state";
import { createStoredDocument } from "./storedDocument";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { documentIncomingUpdateIsolationFailureHandler } from "./syncShared";
import { importSyncedDocumentUpdates } from "./syncUpdateImport";

function ordinaryRawHistoryUpdates<T extends { checkpointKind?: string }>(
  updates: readonly T[],
): T[] {
  return updates.filter((update) => update.checkpointKind === undefined);
}

function assertRotationRecoveryPrerequisites(state: DocumentStoreState) {
  if (state.persistence.supportsAtomicRecoveryHistoryPruning !== true) {
    throw new Error(
      "Rotation raw-history recovery requires an adapter with atomic local-history pruning",
    );
  }
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

function assertRotationRecoveryGeneration(input: {
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): void {
  if (!isDocumentStoreSyncGenerationCurrent(input.state, input.generation)) {
    throw new Error(
      "Document changed during rotation recovery; retry key rotation",
    );
  }
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

    assertRotationRecoveryGeneration(input);

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

async function collectVerifiedRawHistoryForRotation(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}) {
  const rebuiltDocument = await createStoredDocument(input.state);
  try {
    const synced = await pullVerifiedRawHistoryForRotation({
      ...input,
      rebuiltDocument,
    });
    return { rebuiltDocument, synced };
  } catch (error) {
    rebuiltDocument.free();
    throw error;
  }
}

function assertCapturedDocumentCurrent(input: {
  capturedVersion: string;
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): void {
  assertRotationRecoveryGeneration(input);
  if (
    !versionVectorsEqual(
      encodeVersionVector(input.currentDocument),
      input.capturedVersion,
    )
  ) {
    throw new Error(
      "Document changed during rotation recovery; retry key rotation",
    );
  }
}

function currentRotationRecoveryRecord(
  state: DocumentStoreState,
): NonNullable<DocumentStoreState["record"]> {
  if (state.record) return state.record;
  throw new Error(
    "Document changed during rotation recovery; retry key rotation",
  );
}

async function recoverFullHistoryForRotation(
  state: DocumentStoreState,
): Promise<Uint8Array> {
  assertRotationRecoveryPrerequisites(state);
  await invalidatePullContinuationBeforeRotation(state);
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
  let settlementRequiresRetry = false;

  // A raw recovery starts from an empty scratch document, bypasses untrusted
  // rotation-baseline redirects, drains every retained page in memory, and
  // publishes nothing until all response updates have validated. Checkpoints
  // are authenticated and decrypted but are not reconstruction inputs: the
  // original ordinary update stream is the source of truth in this mode.
  let collection = await collectVerifiedRawHistoryForRotation({
    currentRecord,
    generation,
    state,
  });

  try {
    assertCapturedDocumentCurrent({
      capturedVersion,
      currentDocument: currentDoc,
      generation,
      state,
    });
    const pendingUpdates = await listPendingUpdates(state);
    assertRotationRecoveryGeneration({ generation, state });
    const verifiedOrdinaryVersion = importProvenOrdinaryPendingHistory({
      currentDocument: currentDoc,
      pendingUpdates,
      rebuiltDocument: collection.rebuiltDocument,
    });
    if (pendingUpdates.some((update) => update.sourceVersionVector == null)) {
      // The first raw pass proves the exact ordinary frontier before any local
      // row can be published. Pull raw history again after settlement so the
      // installed snapshot also includes remote work that raced that submit.
      await settleOrdinaryDocumentUpdatesBeforeRotation(
        state,
        verifiedOrdinaryVersion,
      );
      assertCapturedDocumentCurrent({
        capturedVersion,
        currentDocument: currentDoc,
        generation,
        state,
      });
      const definitiveCollection = await collectVerifiedRawHistoryForRotation({
        currentRecord: currentRotationRecoveryRecord(state),
        generation,
        state,
      });
      collection.rebuiltDocument.free();
      collection = definitiveCollection;
    }
    const installed = await chainIdentityWrite(state, async () => {
      assertCapturedDocumentCurrent({
        capturedVersion,
        currentDocument: currentDoc,
        generation,
        state,
      });
      assertExactDocumentHistory({
        currentDocument: currentDoc,
        rebuiltDocument: collection.rebuiltDocument,
      });
      return installRebuiltDocument({
        consumedPullContinuation: state.pullContinuation,
        currentRecord: currentRotationRecoveryRecord(state),
        generation,
        rebuiltDoc: collection.rebuiltDocument,
        state,
        synced: collection.synced,
      });
    });
    settlementRequiresRetry = installed.settlementRequiresRetry;
    if (settlementRequiresRetry) {
      throw new Error(
        "Rotation raw-history recovery was superseded during its atomic install; retry key rotation",
      );
    }
    return installed.fullHistorySnapshot;
  } finally {
    if (state.doc !== collection.rebuiltDocument) {
      collection.rebuiltDocument.free();
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
