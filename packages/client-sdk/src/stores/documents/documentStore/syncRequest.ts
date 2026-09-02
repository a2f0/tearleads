import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentRecord,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  type ExecSql,
  type PendingUpdateRecord,
  reclaimDocumentOrphanBlobs,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { chainIdentityWrite } from "./identityWriteChain";
import { invalidateDocumentStorePullContinuation } from "./pullContinuationInvalidation";
import {
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  markDocumentStoreRemoved,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import {
  documentIncomingUpdateIsolationFailureHandler,
  documentRevalidationFailureHandler,
  documentTerminalSubmitFailureHandler,
} from "./syncShared";
import { documentSyncContextMatches } from "./syncUpdateImport";

/**
 * Destroying queued local edits here is settled policy, not an oversight
 * (docs/sync-edge-cases.md row 1): deletion is a privacy operation, so an
 * authoritative remote delete removes the document and its unsynced edits
 * everywhere with no preservation copy. Quarantine/export were rejected —
 * they retain or re-upload content the user deliberately destroyed.
 */
export async function deleteUpstreamDeletedDocument(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  requestRecord: DocumentRecord,
  remoteDocumentId: string,
  commitPurgeProof?: (transactionExecSql: ExecSql) => Promise<void>,
) {
  await chainIdentityWrite(state, async () => {
    if (
      !isDocumentStoreSyncGenerationCurrent(state, generation) ||
      !documentSyncContextMatches(state.record, requestRecord, remoteDocumentId)
    ) {
      return;
    }

    const canDeleteCapturedDocument = () =>
      isDocumentStoreSyncGenerationCurrent(state, generation) &&
      documentSyncContextMatches(state.record, requestRecord, remoteDocumentId);
    let removedInMutation = false;
    const deletionStarted = await deletePersistedDocument({
      beforeDeleteInTransaction: commitPurgeProof,
      canStartDurableMutation: canDeleteCapturedDocument,
      documentProjectors: state.runtime.infra.documentProjectors,
      execSql: generation.execSql,
      expectedRecord: requestRecord,
      localId: requestRecord.id,
      // Invalidate the store generation INSIDE the deletion mutation: a
      // terminal failure handler queued behind it then observes the stale
      // generation and cannot resurrect a failure row the deletes removed.
      onDeletedInMutation: () => {
        if (canDeleteCapturedDocument()) {
          markDocumentStoreRemoved(state);
          removedInMutation = true;
        }
      },
      persistence: state.persistence,
    });
    if (!deletionStarted || !removedInMutation) {
      return;
    }
    if (state.persistence === defaultDocumentsPersistence) {
      void reclaimDocumentOrphanBlobs(state.runtime);
    }
    state.runtime.util.log(
      `Documents: removed local document ${state.localId} after remote deletion.`,
    );
  });
}

function createDocumentSyncAttempt(input: {
  currentRecord: DocumentRecord;
  outgoingUpdateCount: number;
  requestedPullContinuation: DocumentStoreState["pullContinuation"];
  synced: DocumentSyncAttempt["synced"];
}): DocumentSyncAttempt {
  return {
    consumedPullContinuation:
      input.synced.plan.request.pullCursor === undefined
        ? null
        : input.requestedPullContinuation,
    outgoingUpdateCount: input.outgoingUpdateCount,
    requestRecord: input.currentRecord,
    synced: input.synced,
  };
}

interface RequestRemoteDocumentSyncInput {
  allowRecoveryBaseline?: boolean | undefined;
  currentDoc: DocumentState;
  currentRecord: DocumentRecord;
  encapsulationKeyPair: EncapsulationKeyPair;
  generation: DocumentStoreSyncGeneration;
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  pendingUpdates: PendingUpdateRecord[];
  queuedUpdateCount?: number | undefined;
  state: DocumentStoreState;
  unavailableWriterLogMessage: string;
}

function runRemoteDocumentSync(
  input: RequestRemoteDocumentSyncInput,
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>,
  documentId: string,
  requestedPullContinuation: DocumentStoreState["pullContinuation"],
) {
  const { currentDoc, currentRecord, generation, pendingUpdates, state } =
    input;
  const runtime = state.runtime;
  return syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    // Heal a stale content-key bundle from this full-history snapshot. Rotation
    // settlement disables this: it may submit only the ordinary local stream.
    ...(input.allowRecoveryBaseline === false
      ? {}
      : {
          buildRotationSnapshot: async () =>
            exportFullHistorySnapshot(currentDoc),
        }),
    documentId,
    execSql: runtime.infra.execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    onRemoteDocumentDeleted: ({ commitPurgeProof, documentId }) =>
      deleteUpstreamDeletedDocument(
        state,
        generation,
        currentRecord,
        documentId,
        commitPurgeProof,
      ),
    onSyncTrace: (line) => runtime.util.log(`Documents: ${line}`),
    onReadOnlyProjectionFailure: documentRevalidationFailureHandler(
      state,
      generation,
    ),
    onIncomingUpdateIsolationFailure:
      documentIncomingUpdateIsolationFailureHandler(state, generation),
    onOutgoingUpdatesMaterialized: input.onOutgoingUpdatesMaterialized,
    onPullContinuationInvalidated: (continuation) =>
      invalidateDocumentStorePullContinuation({
        continuation,
        currentRecord,
        generation,
        state,
      }),
    onTerminalSubmitFailure: documentTerminalSubmitFailureHandler(
      state,
      generation,
    ),
    pendingUpdates,
    persistedState: currentRecord,
    pullContinuation: requestedPullContinuation ?? undefined,
    rekeyPendingUpdate: state.persistence.rekeyPendingUpdate,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime,
      writerKeyLabel: "writer key",
    }),
    stillCurrent: () => isDocumentStoreSyncGenerationCurrent(state, generation),
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    validateIncomingUpdates: (result) =>
      validateDocumentSyncUpdateImports({
        currentDocument: currentDoc,
        decryptedUpdates: result.decryptedUpdates,
        responseUpdates: result.response.updates,
      }),
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
    writerProjection:
      state.writerProjection?.documentId === currentRecord.documentId
        ? state.writerProjection
        : undefined,
  });
}

export async function requestRemoteDocumentSync(
  input: RequestRemoteDocumentSyncInput,
): Promise<DocumentSyncAttempt | null> {
  const {
    currentRecord,
    generation,
    pendingUpdates,
    state,
    unavailableWriterLogMessage,
  } = input;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

  const runtime = state.runtime;
  if (!currentRecord.documentId) return null;

  const requestedPullContinuation = state.pullContinuation;

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(unavailableWriterLogMessage);
    return null;
  }

  const synced = await runRemoteDocumentSync(
    input,
    author,
    currentRecord.documentId,
    requestedPullContinuation,
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
  if (!synced) return null;

  const outgoingUpdateCount = input.queuedUpdateCount ?? pendingUpdates.length;
  return createDocumentSyncAttempt({
    currentRecord,
    outgoingUpdateCount,
    requestedPullContinuation,
    synced,
  });
}
