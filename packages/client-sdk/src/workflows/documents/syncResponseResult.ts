import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { decryptDocumentSyncUpdatesByEpoch } from "../../data/documents/shared/crypto";
import { persistedDocumentSyncStateFromResponse } from "../../data/documents/shared/responses";
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
  type RekeyPendingUpdate,
  rekeyAndReportUnsettledRecoveryPendingUpdates,
  settledPendingUpdateIdsFromSync,
} from "./syncRecoveryRekey";

export async function syncRemoteDocumentResultFromResponse(input: {
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentSyncPlan;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  response: DocumentSyncResponse;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<SyncRemoteDocumentResult> {
  const { plan } = input.materializedPlan;
  const persistedState = await persistedDocumentSyncStateFromResponse(
    plan,
    input.response,
    {
      resolveWriterPublicKey: input.resolveWriterPublicKey,
      writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
    },
  );
  const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: input.materializedPlan.contentKey,
    currentContentKeyEpoch: plan.contentKeyEpoch,
    execSql: input.execSql,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  const decryptedUpdates = await decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });
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
    }).filter(
      (updateId) =>
        updateId !== input.materializedPlan.staleRecoveryBaselineUpdateId,
    ),
    ...(input.materializedPlan.heldBackPendingUpdateIds ?? []),
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
    persistedState,
    plan,
    rekeyedPendingUpdateIds,
    response: input.response,
    settledPendingUpdateIds,
    writerProjection: input.writerProjection,
  };
}
