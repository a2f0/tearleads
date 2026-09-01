import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type {
  MaterializedDocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { DocumentRawHistoryUnavailableError } from "./syncContentKeys";
import { refreshSyncAttemptWriterProjection } from "./syncFailures";
import {
  hasDeferredPendingUpdatesAfterSubmit,
  responseAcceptedRecoveryBaseline,
} from "./syncPlanRequestBounds";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";
import { traceHealed } from "./syncTrace";

type SubmittedDocumentSyncResultInput = {
  materializedPlan: MaterializedDocumentSyncPlan;
  pendingUpdateIds: readonly string[];
  pullComplete: boolean;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  response: DocumentSyncResponse;
  sync: SyncRemoteDocumentInput;
  writerProjection: DocumentWriterProjectionResponse;
};

function evictHealedWriterProjection(
  input: SyncRemoteDocumentInput,
  materializedPlan: MaterializedDocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  if (
    materializedPlan.healedStaleContentKeyBundle &&
    responseAcceptedRecoveryBaseline(materializedPlan, response)
  ) {
    input.apiClient.evictDocumentWriterProjection?.(input.documentId);
  }
}

async function submittedDocumentSyncResult(
  input: SubmittedDocumentSyncResultInput,
): Promise<SyncRemoteDocumentResult> {
  const result = await syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input.sync),
    execSql: input.sync.execSql,
    materializedPlan: input.materializedPlan,
    onTerminalSubmitFailure: input.sync.onTerminalSubmitFailure,
    recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
    rekeyPendingUpdate: input.sync.rekeyPendingUpdate,
    resolveWriterPublicKey: input.sync.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.sync.targetSecretKey,
    validateIncomingUpdates: input.sync.validateIncomingUpdates,
    writerProjection: input.writerProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  evictHealedWriterProjection(
    input.sync,
    input.materializedPlan,
    input.response,
  );
  if (
    input.materializedPlan.healedStaleContentKeyBundle &&
    responseAcceptedRecoveryBaseline(input.materializedPlan, input.response)
  ) {
    traceHealed(input.sync.onSyncTrace, {
      accepted: input.response.acceptedOutgoingUpdateIds.length,
      documentId: input.materializedPlan.plan.documentId,
      epoch: input.materializedPlan.plan.contentKeyEpoch,
    });
  }
  return {
    ...result,
    hasDeferredPendingUpdates:
      (input.materializedPlan.plan.request.pullCursor !== undefined &&
        input.pendingUpdateIds.length > 0 &&
        result.exhaustedPendingUpdateCount === 0) ||
      hasDeferredPendingUpdatesAfterSubmit({
        acceptedRecoveryBaseline: result.acceptedRecoveryBaseline,
        exhaustedPendingUpdateCount: result.exhaustedPendingUpdateCount,
        pendingUpdateIds: input.pendingUpdateIds,
        rekeyedPendingUpdateIds: result.rekeyedPendingUpdateIds,
        settledPendingUpdateIds: result.settledPendingUpdateIds,
      }),
    hasIncompletePull: !input.pullComplete,
  };
}

async function retryRawHistoryWithFreshProjection(
  input: SubmittedDocumentSyncResultInput,
  unavailableError: DocumentRawHistoryUnavailableError,
): Promise<SyncRemoteDocumentResult | null> {
  const writerProjection = await refreshSyncAttemptWriterProjection({
    apiClient: input.sync.apiClient,
    documentId: input.sync.documentId,
    onRemoteDocumentDeleted: input.sync.onRemoteDocumentDeleted,
    onSyncAbandoned: input.sync.onSyncAbandoned,
    onSyncTrace: input.sync.onSyncTrace,
    onTerminalFailure: input.sync.onReadOnlyProjectionFailure,
    unavailableError,
  });
  if (!writerProjection) return null;
  return submittedDocumentSyncResult({
    ...input,
    writerProjection,
  });
}

export async function resolveSubmittedDocumentSyncResult(
  input: SubmittedDocumentSyncResultInput,
): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await submittedDocumentSyncResult(input);
  } catch (error) {
    if (
      input.sync.historyMode !== "raw" ||
      !(error instanceof DocumentRawHistoryUnavailableError)
    ) {
      throw error;
    }
    return retryRawHistoryWithFreshProjection(input, error);
  }
}
