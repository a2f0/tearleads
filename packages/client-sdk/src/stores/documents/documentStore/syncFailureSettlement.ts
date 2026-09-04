import {
  isStaleCitationError,
  reportAndRethrowKeyingVerificationError,
} from "../../../data/keyingProjectionVerification/error";
import { isDatabaseUnavailableError } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

/**
 * Settles a scheduled sync pass that threw. A database that went away ends
 * the pass without a result. A container head that cites a stale ancestor
 * head cannot be told from a stale delivery until a later event on the
 * container cites the current heads, so the pass ends here with no incident
 * and the next trigger retries; pending writes stay queued. Any other keying
 * verification failure is reported and rethrown.
 */
export async function settleScheduledSyncFailure(
  state: Pick<DocumentStoreState, "localId" | "record" | "runtime">,
  error: unknown,
): Promise<boolean> {
  if (isDatabaseUnavailableError(error)) {
    return false;
  }
  const documentId = state.record?.documentId ?? state.localId;
  if (isStaleCitationError(error)) {
    state.runtime.util.log(
      `Document sync: deferred ${documentId} because a container head cites a stale ancestor head; a later event on the container that cites the current heads supersedes it.`,
    );
    return true;
  }
  await reportAndRethrowKeyingVerificationError(
    error,
    state.runtime.util.reportSecurityIncident,
    {
      objectId: documentId,
      objectKind: "document",
      operation: "document.sync",
    },
  );
  throw error;
}
