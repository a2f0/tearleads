import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { persistedDocumentSyncStateFromResponse } from "../../../data/documents/shared/responses";
import type {
  DocumentSyncPlan,
  SyncRemoteDocumentResult,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { continuedBaselineGroupRun } from "../../../data/documents/shared/sync/pullContinuation";
import type { DocumentSyncPullContinuation } from "../../../data/documents/shared/sync/syncPagination";
import type { DocumentWriterPublicKeyResolver } from "../../../data/documents/shared/types";
import { baselineGroupRunAfterPage } from "./syncResponseResult";

/** The result of a read-only page that served no update. */
async function emptyPageSyncResult(input: {
  readonly persistedState: SyncRemoteDocumentResult["persistedState"];
  readonly plan: DocumentSyncPlan;
  readonly pullComplete: boolean;
  readonly pullContinuation: DocumentSyncPullContinuation | undefined;
  readonly response: DocumentSyncResponse;
}): Promise<SyncRemoteDocumentResult> {
  return {
    // A page with no updates still ends a pull, or carries its run on.
    baselineGroupRun: await baselineGroupRunAfterPage({
      baselineGroupRun: continuedBaselineGroupRun(
        input.pullContinuation,
        input.plan.request.pullCursor,
      ),
      plan: input.plan,
      response: input.response,
    }),
    contentKey: new Uint8Array(),
    decryptedUpdates: [],
    exhaustedPendingUpdateCount: 0,
    hasDeferredPendingUpdates: false,
    hasHeldPull: false,
    hasIncompletePull: !input.pullComplete,
    persistedState: input.persistedState,
    plan: input.plan,
    rekeyedPendingUpdateIds: [],
    response: input.response,
    settledPendingUpdateIds: [],
    acceptedRecoveryBaseline: false,
    voidedUpdates: [],
  };
}

/**
 * Settles a read-only page that served no update, or returns null when the
 * state it left cannot be verified: the caller then plans the pass afresh.
 * A served rotation baseline that breaks a group rule is different. It fails
 * the pass, as it does on a page with updates; starting the pull over
 * without its cursor would forget the group the pull was following.
 */
export async function settleEmptyReadOnlyPage(
  input: {
    readonly historyMode?: "raw" | undefined;
    readonly pullContinuation?: DocumentSyncPullContinuation | undefined;
    readonly resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  },
  plan: DocumentSyncPlan,
  submitted: {
    readonly pullComplete: boolean;
    readonly response: DocumentSyncResponse;
  },
): Promise<SyncRemoteDocumentResult | null> {
  try {
    const persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      submitted.response,
      { resolveWriterPublicKey: input.resolveWriterPublicKey },
    );
    return await emptyPageSyncResult({
      persistedState,
      plan,
      pullComplete: submitted.pullComplete,
      pullContinuation: input.pullContinuation,
      response: submitted.response,
    });
  } catch (error) {
    if (
      input.historyMode === "raw" ||
      isDocumentSyncUpdateIsolationError(error)
    ) {
      throw error;
    }
    return null;
  }
}
