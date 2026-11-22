import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import {
  createDocumentWriterPublicKeyResolver,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  deletePersistedDocument,
  type ExecSql,
  type IncomingDocumentSyncUpdateValidator,
  judgeDocumentSyncImports,
  type PendingUpdateRecord,
  RemoteDocumentService,
  readProcessedCursorForSync,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import { parkForAncestorRepair } from "../ancestorRepairPark";
import { chainIdentityWrite } from "../identityWriteChain";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import {
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  markDocumentStoreRemoved,
} from "../state";
import { invalidateDocumentStorePullContinuation } from "./pullContinuationInvalidation";
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
      deleteDocumentPlacements: state.runtime.deleteDocumentPlacements,
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
    void runDocumentOrphanMaintenance(state);
    state.runtime.util.log(
      `Documents: removed local document ${state.localId} after remote deletion.`,
    );
  });
}

function createDocumentSyncAttempt(input: {
  currentRecord: DocumentRecord;
  outgoingUpdateCount: number;
  policyOperation: PrincipalPolicyOperation;
  requestedPullContinuation: DocumentStoreState["pullContinuation"];
  synced: DocumentSyncAttempt["synced"];
  writerProjectionGeneration: number;
}): DocumentSyncAttempt {
  return {
    consumedPullContinuation:
      input.synced.plan.request.pullCursor === undefined
        ? null
        : input.requestedPullContinuation,
    outgoingUpdateCount: input.outgoingUpdateCount,
    policyOperation: input.policyOperation,
    requestRecord: input.currentRecord,
    synced: input.synced,
    writerProjectionGeneration: input.writerProjectionGeneration,
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
  /** The pass or workflow operation the sync's policy reads belong to. */
  policyOperation: PrincipalPolicyOperation;
  queuedUpdateCount?: number | undefined;
  state: DocumentStoreState;
  unavailableWriterLogMessage: string;
}

/** The pull continuation a pass resumes and the processed cursor it sends. */
interface PullStart {
  readonly continuation: DocumentStoreState["pullContinuation"];
  readonly processedThroughUpdateId: string | undefined;
}

/**
 * Where the document's pull stands, which decides whether a pause holds it,
 * and the processed cursor it starts after.
 */
function pullPosition(
  record: RequestRemoteDocumentSyncInput["currentRecord"],
  { continuation, processedThroughUpdateId }: PullStart,
) {
  return {
    minLsn: record.lastCommitLsn ?? undefined,
    processedThroughUpdateId,
    pullContinuation: continuation ?? undefined,
    pullRecoveryRequired: record.pullContinuationRecoveryRequired === true,
  };
}

/** Judges a page against the live document, skipping this scope's known voids. */
function documentImportJudge(
  state: RequestRemoteDocumentSyncInput["state"],
  currentDocument: RequestRemoteDocumentSyncInput["currentDoc"],
): IncomingDocumentSyncUpdateValidator {
  return (result) =>
    judgeDocumentSyncImports({
      currentDocument,
      execSql: state.runtime.infra.execSql,
      result,
      scope: { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
    });
}

function runRemoteDocumentSync(
  input: RequestRemoteDocumentSyncInput,
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>,
  documentId: string,
  pullStart: PullStart,
) {
  const { currentDoc, currentRecord, generation, pendingUpdates, state } =
    input;
  const runtime = state.runtime;
  const writerProjectionGenerationAtStart = state.writerProjectionGeneration;
  state.awaitingAncestorRepair = false;
  // The generation's API client and executor with the pass's key.
  const remoteDocuments = new RemoteDocumentService({
    api: runtime.apiClient,
    encapsulationSecretKey: input.encapsulationKeyPair.secretKey,
    execSql: runtime.infra.execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
  });
  return remoteDocuments.syncRemoteDocument({
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
    localVersionVector: encodeVersionVector(currentDoc),
    ...pullPosition(currentRecord, pullStart),
    onRemoteDocumentDeleted: ({ commitPurgeProof, documentId }) =>
      deleteUpstreamDeletedDocument(
        state,
        generation,
        currentRecord,
        documentId,
        commitPurgeProof,
      ),
    onSyncAbandoned: (reason) => {
      if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return;
      const hintLandedMidPass = parkForAncestorRepair(
        state,
        reason,
        writerProjectionGenerationAtStart,
      );
      if (hintLandedMidPass) requestDocumentStoreSync(state);
    },
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
    rekeyPendingUpdate: state.persistence.rekeyPendingUpdate,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime,
      writerKeyLabel: "writer key",
    }),
    stillCurrent: () => isDocumentStoreSyncGenerationCurrent(state, generation),
    validateIncomingUpdates: documentImportJudge(state, currentDoc),
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer({
      operation: input.policyOperation,
    }),
    writerProjection:
      state.writerProjection?.documentId === currentRecord.documentId &&
      !isRejectedDecodedProjection(state.writerProjection)
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
  // Captured before the network round trip: a hint that lands meanwhile
  // must keep the response's projection out of the cache.
  const writerProjectionGeneration = state.writerProjectionGeneration;

  const runtime = state.runtime;
  if (!currentRecord.documentId) return null;

  const requestedPullContinuation = state.pullContinuation;

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(unavailableWriterLogMessage);
    return null;
  }

  const processedThroughUpdateId = await readProcessedCursorForSync(
    generation.execSql,
    {
      documentId: currentRecord.documentId,
      frontier: currentRecord.snapshotEndVersion,
      scope: { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
    },
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
  const synced = await runRemoteDocumentSync(
    input,
    author,
    currentRecord.documentId,
    { continuation: requestedPullContinuation, processedThroughUpdateId },
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
  if (!synced) return null;

  const outgoingUpdateCount = input.queuedUpdateCount ?? pendingUpdates.length;
  return createDocumentSyncAttempt({
    currentRecord,
    outgoingUpdateCount,
    policyOperation: input.policyOperation,
    requestedPullContinuation,
    synced,
    writerProjectionGeneration,
  });
}
