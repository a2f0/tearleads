import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { ContainerKekRepairInaccessibleError } from "../../../data/documents/shared/containerKek/containerKekCurrency";
import { assertDocumentManifestBundleConsistent } from "../../../data/documents/shared/readers";
import { isDocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import { pullPageRequest } from "../../../data/documents/shared/sync/pullContinuation";
import {
  type DocumentSyncPullContinuation,
  resolvePullContinuationMinLsn,
} from "../../../data/documents/shared/sync/syncPagination";
import { checkWithHeldBundleRecovery } from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import {
  DocumentRotationBaselineUploadEndedError,
  isDocumentRotationBaselineStageError,
} from "../baselineStage/rotationBaselineErrors";
import { retrySyncPlanOrAbandon } from "../syncFailures";
import {
  abandonAncestorRepair,
  abandonBlockedSync,
  abandonEndedBaselineUpload,
  abandonInaccessibleAncestorRepair,
  abandonOversizedSyncPlan,
  abandonRefusedBaselineStage,
  isPullUnderWay,
} from "../syncFailures/syncAbandon";
import type { TerminalSubmitFailureHandler } from "../syncFailures/syncFailureClassification";
import {
  DocumentAncestorRepairAbandonedError,
  DocumentSyncPreparationRequiredError,
} from "../syncFailures/syncRepairAbandon";
import { prepareSyncAttemptContainerRekeys } from "../syncRekeys/syncContainerRekeyPreparation";
import { buildRemoteDocumentSyncPlan } from "../syncRekeys/syncContainerRekeys";
import type { RemoteDocumentSyncPass } from "./remoteDocumentSyncPass";

/**
 * A write-bearing pass records through the submit handler (its queued writes
 * are what the failure blocks). A read-only pass records through the
 * revalidation handler so the refusal still leaves a durable trail instead
 * of silently never revalidating (edge-case row 13). A cursor continuation is
 * wire-level read-only, but its failure still blocks the queued writes it
 * deliberately deferred. Update-id recovery likewise empties the in-flight
 * batch while durable rows remain. Both keep the submit classification and
 * its 403 handling.
 */
export function projectionFailureHandler(
  input: RemoteDocumentSyncPass,
  failureBlocksQueuedWrites: boolean,
): TerminalSubmitFailureHandler | undefined {
  return failureBlocksQueuedWrites
    ? input.onTerminalSubmitFailure
    : input.onReadOnlyProjectionFailure;
}
/**
 * The queued writes this attempt sends, or null when their organization is
 * held and the attempt has to stop. A cursor continuation sends none. Nor
 * does the restart of a pull whose cursor expired while its organization is
 * held: a held organization sends nothing, but a pull that already fetched a
 * page still has to finish, so the writes stay queued behind it.
 */
async function plannedPendingUpdates(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  sync: RemoteDocumentSyncPass;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<readonly PendingUpdateRecord[] | null> {
  if (input.pullContinuation !== undefined) return [];
  if (input.sync.deferQueuedWrites === true) return [];
  if (input.pendingUpdates.length === 0) return input.pendingUpdates;
  // A held head this check refuses is dropped, so the next sync fetches it.
  const { organizationId } = await checkWithHeldBundleRecovery(
    {
      execSql: input.sync.execSql,
      projection: input.writerProjection,
      stillCurrent: input.sync.stillCurrent,
    },
    () =>
      assertDocumentManifestBundleConsistent({
        bundle: input.writerProjection.documentManifest,
        label: "Document sync manifest",
      }),
  );
  if (!input.sync.isRemoteSyncBlocked?.(organizationId)) {
    return input.pendingUpdates;
  }
  return isPullUnderWay(input.sync) ? [] : null;
}

/**
 * What a failure to plan means for the pass: a retry, an abandonment that
 * leaves the writes queued, or an error that is the caller's.
 */
function abandonUnplannedSyncAttempt(
  sync: RemoteDocumentSyncPass,
  error: unknown,
) {
  if (error instanceof DocumentSyncPreparationRequiredError) {
    return "retry" as const;
  }
  if (error instanceof DocumentAncestorRepairAbandonedError) {
    return abandonAncestorRepair(sync, error);
  }
  if (error instanceof ContainerKekRepairInaccessibleError) {
    return abandonInaccessibleAncestorRepair(sync, error);
  }
  if (error instanceof DocumentRotationBaselineUploadEndedError) {
    return abandonEndedBaselineUpload(sync, error);
  }
  if (isDocumentRotationBaselineStageError(error)) {
    return abandonRefusedBaselineStage(sync, error);
  }
  if (!isDocumentSyncRequestLimitError(error)) throw error;
  return abandonOversizedSyncPlan(sync, error);
}

export async function planDocumentSyncAttempt(input: {
  /** The version the request advertises; defaults to the sync's live one. */
  localVersionVector?: string | null | undefined;
  pendingUpdates: readonly PendingUpdateRecord[];
  /** The processed cursor the request may carry; see `processedCursor.ts`. */
  processedThroughUpdateId?: string | undefined;
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  sync: RemoteDocumentSyncPass;
  failureBlocksQueuedWrites: boolean;
  writerProjection: DocumentWriterProjectionResponse;
}) {
  try {
    const pendingUpdates = await plannedPendingUpdates(input);
    if (!pendingUpdates) return abandonBlockedSync(input.sync);
    // Durable repair happens once at this explicit attempt boundary. The
    // retryable builder below may only sign inline plans against its projection.
    const prepared =
      pendingUpdates.length &&
      !input.sync.buildContainerRekeys &&
      input.sync.buildRotationSnapshot
        ? await prepareSyncAttemptContainerRekeys(
            input.sync,
            input.writerProjection,
          )
        : { projection: input.writerProjection, plans: undefined };
    if (!prepared) return null;
    return await retrySyncPlanOrAbandon({
      apiClient: input.sync.apiClient,
      buildWithProjection: (projection) =>
        buildRemoteDocumentSyncPlan({
          pendingUpdates,
          ...pullPageRequest(input.localVersionVector, input.pullContinuation),
          preparedRekeys:
            projection === prepared.projection ? prepared.plans : undefined,
          minLsn: resolvePullContinuationMinLsn(
            input.pullContinuation,
            input.sync.minLsn,
          ),
          processedThroughUpdateId: input.processedThroughUpdateId,
          projection,
          sync: input.sync,
        }),
      documentId: input.sync.documentId,
      onRemoteDocumentDeleted: input.sync.onRemoteDocumentDeleted,
      onSyncAbandoned: input.sync.onSyncAbandoned,
      onSyncTrace: input.sync.onSyncTrace,
      onTerminalFailure: projectionFailureHandler(
        input.sync,
        input.failureBlocksQueuedWrites,
      ),
      stillCurrent: input.sync.stillCurrent,
      writerProjection: prepared.projection,
    });
  } catch (error) {
    return abandonUnplannedSyncAttempt(input.sync, error);
  }
}
