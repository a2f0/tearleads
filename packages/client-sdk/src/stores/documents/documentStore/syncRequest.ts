import { encodeVersionVector, exportFullHistorySnapshot } from "@symcrypt/loro";
import {
  clearDocumentSyncFailure,
  createDocumentWriterPublicKeyResolver,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  type PendingUpdateRecord,
  reclaimDocumentOrphanBlobs,
  resolveDocumentCreateAuthor,
  shouldClearDocumentSyncFailureAfterPass,
  syncRemoteDocument,
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

async function clearSuccessfulDocumentSyncFailure(input: {
  generation: DocumentStoreSyncGeneration;
  outgoingUpdateCount: number;
  state: DocumentStoreState;
  synced: DocumentSyncAttempt["synced"];
}): Promise<boolean> {
  if (
    shouldClearDocumentSyncFailureAfterPass(
      input.synced,
      input.outgoingUpdateCount,
    )
  ) {
    await clearDocumentSyncFailure(input.state.runtime.infra.execSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: input.state.localId,
    });
  }
  return isDocumentStoreSyncGenerationCurrent(input.state, input.generation);
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
    // Heal a stale content-key bundle from this full-history snapshot.
    buildRotationSnapshot: async () => exportFullHistorySnapshot(currentDoc),
    documentId,
    execSql: runtime.infra.execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    onRemoteDocumentDeleted: ({ documentId }) =>
      deleteUpstreamDeletedDocument(
        state,
        generation,
        currentRecord,
        documentId,
      ),
    onSyncTrace: (line) => runtime.util.log(`Documents: ${line}`),
    onReadOnlyProjectionFailure: documentRevalidationFailureHandler(
      state,
      generation,
    ),
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
    targetSecretKey: input.encapsulationKeyPair.secretKey,
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
  if (
    !(await clearSuccessfulDocumentSyncFailure({
      generation,
      outgoingUpdateCount,
      state,
      synced,
    }))
  )
    return null;

  return createDocumentSyncAttempt({
    currentRecord,
    outgoingUpdateCount,
    requestedPullContinuation,
    synced,
  });
}
