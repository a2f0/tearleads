import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { ContainerKekRepairInaccessibleError } from "../../data/documents/shared/containerKekCurrency";
import { assertDocumentManifestBundleConsistent } from "../../data/documents/shared/readers";
import {
  type DocumentSyncPullContinuation,
  resolvePullContinuationMinLsn,
} from "../../data/documents/shared/syncPagination";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { isDocumentSyncRequestLimitError } from "../../data/sync/documentSyncOutgoingBatch";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import {
  abandonAncestorRepair,
  abandonBlockedSync,
  abandonInaccessibleAncestorRepair,
  abandonOversizedSyncPlan,
} from "./syncAbandon";
import { prepareSyncAttemptContainerRekeys } from "./syncContainerRekeyPreparation";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";
import type { TerminalSubmitFailureHandler } from "./syncFailureClassification";
import { retrySyncPlanOrAbandon } from "./syncFailures";
import {
  DocumentAncestorRepairAbandonedError,
  DocumentSyncPreparationRequiredError,
} from "./syncRepairAbandon";

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
  input: SyncRemoteDocumentInput,
  failureBlocksQueuedWrites: boolean,
): TerminalSubmitFailureHandler | undefined {
  return failureBlocksQueuedWrites
    ? input.onTerminalSubmitFailure
    : input.onReadOnlyProjectionFailure;
}
export async function planDocumentSyncAttempt(input: {
  pendingUpdates: readonly PendingUpdateRecord[];
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  regenerateQueuedCheckpoints: boolean;
  sync: SyncRemoteDocumentInput;
  failureBlocksQueuedWrites: boolean;
  writerProjection: DocumentWriterProjectionResponse;
}) {
  try {
    const pendingUpdates =
      input.pullContinuation === undefined ? input.pendingUpdates : [];
    if (
      pendingUpdates.length &&
      input.sync.isRemoteSyncBlocked?.(
        (
          await assertDocumentManifestBundleConsistent({
            bundle: input.writerProjection.documentManifest,
            label: "Document sync manifest",
          })
        ).organizationId,
      )
    ) {
      return abandonBlockedSync(input.sync);
    }
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
          preparedRekeys:
            projection === prepared.projection ? prepared.plans : undefined,
          minLsn: resolvePullContinuationMinLsn(
            input.pullContinuation,
            input.sync.minLsn,
          ),
          pullCursor: input.pullContinuation?.cursor,
          projection,
          regenerateQueuedCheckpoints: input.regenerateQueuedCheckpoints,
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
    if (error instanceof DocumentSyncPreparationRequiredError)
      return "retry" as const;
    if (error instanceof DocumentAncestorRepairAbandonedError) {
      return abandonAncestorRepair(input.sync, error);
    }
    if (error instanceof ContainerKekRepairInaccessibleError) {
      return abandonInaccessibleAncestorRepair(input.sync, error);
    }
    if (!isDocumentSyncRequestLimitError(error)) {
      throw error;
    }
    return abandonOversizedSyncPlan(input.sync, error);
  }
}
