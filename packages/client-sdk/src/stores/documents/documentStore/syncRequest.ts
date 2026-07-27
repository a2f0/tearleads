import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import {
  clearDocumentSyncFailure,
  createDocumentWriterPublicKeyResolver,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  deletePersistedDocument,
  type PendingUpdateRecord,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { chainIdentityWrite } from "./identityWriteChain";
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
    const deletionStarted = await deletePersistedDocument({
      canStartDurableMutation: canDeleteCapturedDocument,
      documentProjectors: state.runtime.infra.documentProjectors,
      execSql: generation.execSql,
      localId: requestRecord.id,
      persistence: state.persistence,
    });
    if (!deletionStarted || !canDeleteCapturedDocument()) {
      return;
    }

    markDocumentStoreRemoved(state);
    state.runtime.util.log(
      `Documents: removed local document ${state.localId} after remote deletion.`,
    );
  });
}

export async function requestRemoteDocumentSync(input: {
  currentDoc: DocumentState;
  currentRecord: DocumentRecord;
  encapsulationKeyPair: EncapsulationKeyPair;
  generation: DocumentStoreSyncGeneration;
  pendingUpdates: PendingUpdateRecord[];
  state: DocumentStoreState;
  unavailableWriterLogMessage: string;
}): Promise<DocumentSyncAttempt | null> {
  const {
    currentDoc,
    currentRecord,
    encapsulationKeyPair,
    generation,
    pendingUpdates,
    state,
    unavailableWriterLogMessage,
  } = input;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

  const runtime = state.runtime;
  if (!currentRecord.documentId) return null;

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(unavailableWriterLogMessage);
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    // Heals a stale content-key bundle (e.g. after a revoke rotated a linked
    // container's KEK) by rotating to a fresh content key anchored by this
    // full-history snapshot.
    buildRotationSnapshot: async () => exportFullHistorySnapshot(currentDoc),
    documentId: currentRecord.documentId,
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
    onTerminalSubmitFailure: documentTerminalSubmitFailureHandler(
      state,
      generation,
    ),
    pendingUpdates,
    persistedState: currentRecord,
    rekeyPendingUpdate: state.persistence.rekeyPendingUpdate,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime,
      writerKeyLabel: "writer key",
    }),
    targetSecretKey: encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
    writerProjection:
      state.writerProjection?.documentId === currentRecord.documentId
        ? state.writerProjection
        : undefined,
  });
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
  if (!synced) return null;

  if (synced.exhaustedPendingUpdateCount === 0) {
    await clearDocumentSyncFailure(runtime.infra.execSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: state.localId,
    });
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}
