import {
  isStaleCitationInCauseChain,
  reportKeyingVerificationErrorInCauseChain,
} from "../../../data/keyingProjectionVerification/error";
import { isDatabaseUnavailableError } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

/** The slice of a document store's state the settlement reads. */
export interface ScheduledSyncFailureState {
  readonly localId: DocumentStoreState["localId"];
  readonly record: Pick<
    NonNullable<DocumentStoreState["record"]>,
    "documentId"
  > | null;
  readonly runtime: {
    readonly util: Pick<
      DocumentStoreState["runtime"]["util"],
      "log" | "reportSecurityIncident"
    >;
  };
}

/**
 * Settles a scheduled sync pass that threw. A database that went away ends
 * the pass without a result. A keying verification failure is recorded in
 * the security-incident ledger and rethrown, so the lane shows it and backs
 * off; one that is a stale citation, a container head by a member with no
 * current authority citing a stale ancestor head, also names its recovery,
 * since only a later event on the container by a member with current
 * authority resolves it. Pending writes stay queued either way.
 */
export async function settleScheduledSyncFailure(
  state: ScheduledSyncFailureState,
  error: unknown,
): Promise<false> {
  if (isDatabaseUnavailableError(error)) {
    return false;
  }
  const documentId = state.record?.documentId ?? state.localId;
  await reportKeyingVerificationErrorInCauseChain(
    error,
    state.runtime.util.reportSecurityIncident,
    {
      objectId: documentId,
      objectKind: "document",
      operation: "document.sync",
    },
  );
  if (isStaleCitationInCauseChain(error)) {
    state.runtime.util.log(
      `Document sync: will retry ${documentId}; a container head cites a stale ancestor head and its signer holds no current authority, and only a later event on the container by a member with current authority supersedes it.`,
    );
  }
  throw error;
}
