import { KeyingVerificationError } from "@symcrypt/crypto";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { decryptDocumentSyncUpdatesByEpoch } from "../../data/documents/shared/crypto";
import {
  type IncomingDocumentSyncUpdateValidator,
  isolateDocumentSyncBatchError,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import { readWriteHeader } from "../../data/documents/shared/readers";
import {
  DocumentSyncResponseUpdateContentKeyError,
  persistedDocumentSyncStateFromResponse,
} from "../../data/documents/shared/responses";
import type {
  DocumentWriterPublicKeyResolver,
  MaterializedDocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { unwrapDocumentSyncResponseContentKeys } from "./syncContentKeys";
import type { TerminalSubmitFailureHandler } from "./syncFailureClassification";
import {
  acceptedHeldBackPendingUpdateIds,
  responseAcceptedRecoveryBaseline,
} from "./syncPlanRequestBounds";
import {
  type RekeyPendingUpdate,
  rekeyAndReportUnsettledRecoveryPendingUpdates,
  settledPendingUpdateIdsFromSync,
} from "./syncRecoveryRekey";

function isolateContentKeyResponseFailure(
  error: unknown,
  response: DocumentSyncResponse,
): never {
  if (
    !(error instanceof DocumentSyncResponseUpdateContentKeyError) ||
    response.updates.length === 0
  ) {
    throw error;
  }
  throw isolateDocumentSyncBatchError({
    cause: new KeyingVerificationError("invalid_shape", error.message),
    stage: "content_key",
    updateIds: response.updates.map((update) => update.id),
  });
}

function rawResponseHasFutureContentKeyEpoch(
  response: DocumentSyncResponse,
  currentContentKeyEpoch: number,
): boolean {
  for (const update of response.updates) {
    try {
      if (
        readWriteHeader(
          update.writeHeader,
          "Document raw-history response write header",
        ).contentKeyEpoch > currentContentKeyEpoch
      ) {
        return true;
      }
    } catch {
      // A malformed header is also poison, never evidence that retained
      // historical key material is unavailable.
      return true;
    }
  }
  return false;
}

type SyncRemoteDocumentResultInput = {
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentSyncPlan;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  response: DocumentSyncResponse;
  targetSecretKey: Uint8Array;
  validateIncomingUpdates: IncomingDocumentSyncUpdateValidator;
  writerProjection: DocumentWriterProjectionResponse;
};

async function resolveVerifiedResponseState(
  input: SyncRemoteDocumentResultInput,
) {
  const { plan } = input.materializedPlan;
  let persistedState: Awaited<
    ReturnType<typeof persistedDocumentSyncStateFromResponse>
  > | null = null;
  let deferredRawContentKeyFailure: DocumentSyncResponseUpdateContentKeyError | null =
    null;
  try {
    persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      input.response,
      {
        resolveWriterPublicKey: input.resolveWriterPublicKey,
      },
    );
  } catch (error) {
    if (
      plan.request.historyMode === "raw" &&
      error instanceof DocumentSyncResponseUpdateContentKeyError &&
      !rawResponseHasFutureContentKeyEpoch(input.response, plan.contentKeyEpoch)
    ) {
      // Let sorted key resolution select the earliest unavailable epoch. If
      // every referenced key resolves (for example, a future epoch), the
      // original response-integrity error is isolated below.
      deferredRawContentKeyFailure = error;
    } else {
      isolateContentKeyResponseFailure(error, input.response);
    }
  }
  const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: input.materializedPlan.contentKey,
    currentContentKeyEpoch: plan.contentKeyEpoch,
    execSql: input.execSql,
    historyMode: plan.request.historyMode,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  if (deferredRawContentKeyFailure) {
    isolateContentKeyResponseFailure(
      deferredRawContentKeyFailure,
      input.response,
    );
  }
  if (!persistedState) {
    throw new Error("Document sync response did not produce persisted state");
  }
  return { contentKeysByEpoch, persistedState };
}

export async function syncRemoteDocumentResultFromResponse(
  input: SyncRemoteDocumentResultInput,
): Promise<SyncRemoteDocumentResult> {
  const { plan } = input.materializedPlan;
  const { contentKeysByEpoch, persistedState } =
    await resolveVerifiedResponseState(input);
  const decryptedUpdates = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });
  await input.validateIncomingUpdates({
    decryptedUpdates,
    response: input.response,
  });
  const recoveryBaselineId =
    input.materializedPlan.staleRecoveryBaselineUpdateId;
  const acceptedRecoveryBaseline = responseAcceptedRecoveryBaseline(
    input.materializedPlan,
    input.response,
  );
  // Two heal-specific corrections: the synthetic heal baseline matches no
  // pending-queue row, so its ack must not count as a settled pending update;
  // and checkpoints the heal held back ARE settled by it — the committed
  // covering baseline subsumes their full-history content, and resubmitting
  // them post-heal could become the LATEST baseline at the healed epoch and
  // shrink the redirect's coverage below the pre-heal frontier.
  const settledPendingUpdateIds = [
    ...settledPendingUpdateIdsFromSync({
      decryptedUpdates,
      recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
      response: input.response,
    }).filter((updateId) => updateId !== recoveryBaselineId),
    ...acceptedHeldBackPendingUpdateIds(input.materializedPlan, input.response),
  ];
  const { exhaustedPendingUpdateCount, rekeyedPendingUpdateIds } =
    await rekeyAndReportUnsettledRecoveryPendingUpdates({
      execSql: input.execSql,
      onTerminalSubmitFailure: input.onTerminalSubmitFailure,
      recoveryPendingUpdatesById: input.recoveryPendingUpdatesById,
      rekeyPendingUpdate: input.rekeyPendingUpdate,
      settledPendingUpdateIds,
    });

  return {
    exhaustedPendingUpdateCount,
    contentKey: input.materializedPlan.contentKey,
    decryptedUpdates,
    hasDeferredPendingUpdates: false,
    hasIncompletePull: false,
    persistedState,
    plan,
    rekeyedPendingUpdateIds,
    response: input.response,
    settledPendingUpdateIds,
    acceptedRecoveryBaseline,
    writerProjection: input.writerProjection,
  };
}
