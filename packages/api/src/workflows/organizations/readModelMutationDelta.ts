import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import { withPreparedPrincipalHistoryOnly } from "../principals/principalHistoryExecution";
import {
  OrganizationManagerError,
  OrganizationReadModelCursorError,
} from "./errors";
import { transactionOrganizationReadModelStamps } from "./readModelChanges";
import { decodeOrganizationReadModelCursor } from "./readModelCursor";
import { loadOrganizationReadModelDeltaInTransaction } from "./readModelFeed";

function decodeHeldCursor(
  heldCursor: string,
  organizationId: string,
): bigint | undefined {
  try {
    return decodeOrganizationReadModelCursor(heldCursor, organizationId);
  } catch (error) {
    if (error instanceof OrganizationReadModelCursorError) return undefined;
    throw error;
  }
}

/**
 * The committer's read-model delta: what a feed read from the cursor the
 * request held returns as soon as this transaction commits. Call it after
 * the transaction's last write. It is served only when the held cursor is the
 * head the transaction's first stamp advanced from, so the delta carries this
 * commit's changes alone and its `nextCursor` is the last stamp, the cursor
 * the commit's hint names. A held cursor from another organization, an
 * unreadable one, a transaction that stamped nothing, and a caller the feed
 * would refuse all leave it out, and the client reads the feed as before.
 */
export async function loadCommittedReadModelDeltaInTransaction(input: {
  readonly heldCursor: string | undefined;
  readonly organizationId: string;
  readonly sessionUserId: string;
  readonly tx: DatabaseTransaction;
}): Promise<OrganizationReadModelDeltaResponse | undefined> {
  if (input.heldCursor === undefined) return undefined;
  const stamps = transactionOrganizationReadModelStamps(
    input.tx,
    input.organizationId,
  );
  if (!stamps) return undefined;
  const held = decodeHeldCursor(input.heldCursor, input.organizationId);
  if (held === undefined || held !== stamps.first - 1n) return undefined;
  try {
    // A savepoint keeps the optional read from aborting the mutation: an SQL
    // failure here rolls back to it, and the mutation commits as before.
    // Prepared history only: cold verification would hold the head lock.
    return await withPreparedPrincipalHistoryOnly(() =>
      input.tx.transaction((savepoint) =>
        loadOrganizationReadModelDeltaInTransaction({
          organizationId: input.organizationId,
          requestedCursor: held,
          sessionUserId: input.sessionUserId,
          tx: savepoint,
        }),
      ),
    );
  } catch (error) {
    // The feed answers an access refusal with 403, 404 or 409, which the
    // client's own read then receives. Any other failure only omits the
    // delta; the client reads the feed as before.
    if (!(error instanceof OrganizationManagerError)) {
      console.error("Failed to build the committed read-model delta:", error);
    }
    return undefined;
  }
}
