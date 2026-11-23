import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { judgeDocumentSyncUpdateDecryption } from "../../../data/documents/shared/crypto";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/projection/projectionVerificationOptions";
import {
  DocumentSyncResponseUpdateContentKeyError,
  persistedDocumentSyncStateFromResponse,
} from "../../../data/documents/shared/responses";
import { deriveDocumentContentKeyCommitments } from "../../../data/documents/shared/sync/contentKeyCommitment";
import type {
  IncomingDocumentSyncUpdateValidator,
  MaterializedDocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import { isolateDocumentSyncBatchError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import {
  requireDocumentSyncImportVerdicts,
  type VoidedDocumentSyncUpdate,
  withoutVoidedUpdates,
} from "../../../data/documents/shared/sync/documentUpdateVerdict";
import type { DocumentWriterPublicKeyResolver } from "../../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TerminalSubmitFailureHandler } from "../syncFailures/syncFailureClassification";
import { unwrapDocumentSyncResponseContentKeys } from "../syncPlan/syncContentKeys";
import {
  acceptedHeldBackPendingUpdateIds,
  responseAcceptedRecoveryBaseline,
} from "../syncPlan/syncPlanRequestBounds";
import {
  type RekeyPendingUpdate,
  rekeyAndReportUnsettledRecoveryPendingUpdates,
  settledPendingUpdateIdsFromSync,
} from "../syncRekeys/syncRecoveryRekey";
import { documentPullOutcome } from "./pullOutcome";

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
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  validateIncomingUpdates: IncomingDocumentSyncUpdateValidator;
  writerProjection: DocumentWriterProjectionResponse;
};

/** @internal Exercises poison precedence for the decryptable subset of a raw page. */
export async function validateDecryptableRawHistorySiblings(input: {
  contentKeysByEpoch: ReadonlyMap<number, Uint8Array>;
  documentId: string;
  organizationId: string;
  response: DocumentSyncResponse;
  updates: readonly DocumentSyncResponse["updates"][number][];
}): Promise<void> {
  if (input.updates.length === 0) return;
  // A void sibling is not a failure, but an envelope, header, or key failure
  // still outranks the unavailable epoch. Import verdicts are not judged:
  // a missing parent may belong to the update this reader cannot decrypt.
  await judgeDocumentSyncUpdateDecryption({
    contentKeysByEpoch: input.contentKeysByEpoch,
    documentId: input.documentId,
    organizationId: input.organizationId,
    updates: input.updates,
  });
}

async function resolveVerifiedResponseState(
  input: SyncRemoteDocumentResultInput,
) {
  const { plan } = input.materializedPlan;
  let persistedState: Awaited<
    ReturnType<typeof persistedDocumentSyncStateFromResponse>
  >;
  try {
    persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      input.response,
      {
        resolveWriterPublicKey: input.resolveWriterPublicKey,
      },
    );
  } catch (error) {
    // Missing or future bundles are response-integrity failures. They must be
    // poison-isolated before key availability is considered, because the
    // referenced update has not yet authenticated against a bundle.
    isolateContentKeyResponseFailure(error, input.response);
  }
  if ((plan.request.containerRekeys?.length ?? 0) > 0) {
    await assertDocumentWriterProjectionConsistent(input.writerProjection, {
      allowStaleContentKeyBundle: true,
      execSql: input.execSql,
      stillCurrent: input.stillCurrent,
      ...projectionVerificationOptions(input),
    });
  }
  const contentKeysByEpoch = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: input.materializedPlan.contentKey,
    currentContentKeyBundle: plan.sourceContentKeyBundle,
    execSql: input.execSql,
    historyMode: plan.request.historyMode,
    onRawHistoryUnavailable: async ({ contentKeysByEpoch, updates }) =>
      validateDecryptableRawHistorySiblings({
        contentKeysByEpoch,
        documentId: plan.documentId,
        organizationId: plan.organizationId,
        response: input.response,
        updates,
      }),
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  return { contentKeysByEpoch, persistedState };
}

function inServerOrder(
  response: DocumentSyncResponse,
  voided: readonly VoidedDocumentSyncUpdate[],
): VoidedDocumentSyncUpdate[] {
  const order = new Map(
    response.updates.map((update, index) => [update.id, index]),
  );
  return [...voided].sort(
    (left, right) =>
      (order.get(left.updateId) ?? 0) - (order.get(right.updateId) ?? 0),
  );
}

/**
 * Decrypts and judges the served updates in server order: a payload that is
 * not its declared update is void before import, and the import verdicts run
 * over what remains, so a writer's follow-up to a void update is void too.
 */
async function judgeDocumentSyncResponseUpdates(
  input: SyncRemoteDocumentResultInput,
  contentKeysByEpoch: ReadonlyMap<number, Uint8Array>,
  contentKeyFingerprintsByEpoch: ReadonlyMap<number, string>,
) {
  const { plan } = input.materializedPlan;
  const decrypted = await judgeDocumentSyncUpdateDecryption({
    contentKeysByEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: input.response.updates,
  });
  const importVerdicts = requireDocumentSyncImportVerdicts(
    await input.validateIncomingUpdates({
      contentKeyFingerprintsByEpoch,
      decryptedUpdates: decrypted.accepted,
      response: input.response,
    }),
  );
  return {
    decryptedUpdates: withoutVoidedUpdates(decrypted.accepted, importVerdicts),
    deferred: importVerdicts.deferredUpdateIds.length > 0,
    held: importVerdicts.heldUpdateIds.length > 0,
    voidedUpdates: inServerOrder(input.response, [
      ...decrypted.voided,
      ...importVerdicts.voided,
    ]),
  };
}

/**
 * The response a pass that deferred or held part of its page hands on: no
 * further page and no continuation, so it still parses as a pull page. A
 * deferral's `hasIncompletePull` makes the next pass start the pull again at
 * once; a hold's `hasHeldPull` leaves that to the next scheduled pull. Either
 * way it is served the unjudged updates once more.
 */
function restartedPull(response: DocumentSyncResponse): DocumentSyncResponse {
  return response.pullPage
    ? {
        ...response,
        pullPage: { ...response.pullPage, hasMore: false, nextCursor: null },
      }
    : response;
}

export async function syncRemoteDocumentResultFromResponse(
  input: SyncRemoteDocumentResultInput,
): Promise<SyncRemoteDocumentResult> {
  const { plan } = input.materializedPlan;
  const { contentKeysByEpoch, persistedState } =
    await resolveVerifiedResponseState(input);
  // The ledger's key fingerprints are the content-key commitments of the
  // keys this pass held, which the envelopes it accepted also name.
  const contentKeyFingerprintsByEpoch =
    await deriveDocumentContentKeyCommitments({
      contentKeysByEpoch,
      documentId: plan.documentId,
    });
  const { decryptedUpdates, deferred, held, voidedUpdates } =
    await judgeDocumentSyncResponseUpdates(
      input,
      contentKeysByEpoch,
      contentKeyFingerprintsByEpoch,
    );
  const pageOutcome = documentPullOutcome({
    deferred,
    held,
    pullComplete: true,
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
      stillCurrent: input.stillCurrent,
    });

  return {
    exhaustedPendingUpdateCount,
    contentKey: input.materializedPlan.contentKey,
    decryptedUpdates,
    hasDeferredPendingUpdates: false,
    // This page's own outcome; `withPullCompletion` adds the server's.
    hasHeldPull: pageOutcome === "held",
    hasIncompletePull: pageOutcome === "deferred",
    persistedState,
    plan,
    rekeyedPendingUpdateIds,
    response: deferred || held ? restartedPull(input.response) : input.response,
    settledPendingUpdateIds,
    acceptedRecoveryBaseline,
    contentKeyFingerprintsByEpoch,
    voidedUpdates,
    writerProjection: input.writerProjection,
  };
}
