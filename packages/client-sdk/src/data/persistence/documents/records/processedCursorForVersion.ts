import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import { documentSyncProgress } from "../../../sqlite/schema/documentSyncVerdictSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";

/**
 * A processed cursor of this server document that a request citing
 * `version` may carry, or undefined when none qualifies. It must be one the
 * running judge reached, recorded with a version that `version` covers: that
 * version holds every update the cursor's pull imported, and the pull voided
 * the rest, so a check of `version` against the document may skip every
 * update up to the cursor. Any local scope's cursor qualifies, because what
 * it judged is the server's history of the document, not the scope's.
 */
export async function readProcessedCursorCoveredBy(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  input: {
    readonly documentId: string;
    readonly judge: string;
    readonly version: string;
  },
): Promise<string | undefined> {
  const rows = await db
    .select({
      throughUpdateId: documentSyncProgress.throughUpdateId,
      throughVersion: documentSyncProgress.throughVersion,
    })
    .from(documentSyncProgress)
    .where(
      and(
        eq(documentSyncProgress.documentId, input.documentId),
        eq(documentSyncProgress.judge, input.judge),
      ),
    );
  for (const { throughUpdateId, throughVersion } of rows) {
    if (
      throughUpdateId &&
      throughVersion !== null &&
      satisfiesVersionVector(input.version, throughVersion)
    ) {
      return throughUpdateId;
    }
  }
  return undefined;
}
