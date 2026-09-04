import {
  isStaleCitationInCauseChain,
  reportKeyingVerificationErrorInCauseChain,
} from "../../../data/keyingProjectionVerification/error";
import { isDatabaseUnavailableError } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

/**
 * Settles a scheduled sync pass that threw. A database that went away ends
 * the pass without a result. A keying verification failure is recorded in
 * the security-incident ledger; one that is a stale citation, a container
 * head by a member with no current authority citing a stale ancestor head,
 * then ends the pass, since only a later event on the container by a member
 * with current authority resolves it: pending writes stay queued and the
 * next trigger retries. Any other failure is rethrown.
 */
export async function settleScheduledSyncFailure(
  state: Pick<DocumentStoreState, "localId" | "record" | "runtime">,
  error: unknown,
): Promise<boolean> {
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
      `Document sync: deferred ${documentId} because a container head cites a stale ancestor head and its signer holds no current authority; a later event on the container by a member with current authority supersedes it.`,
    );
    return true;
  }
  throw error;
}
