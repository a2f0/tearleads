import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { releasePrincipalHistoryRoot } from "./principalHistoryRootOwnership";

const INCOMPLETE_STAGE_LIMIT = 8;
const RECLAIM_BATCH_LIMIT = 16;

/** Disposable work only: completed artifacts and trust pins are unaffected. */
export async function reclaimIncompletePrincipalHistoryStages(
  tx: ClientSQLiteTransactionScope,
  current: {
    readonly id: string;
    readonly scopeId: string;
    readonly organizationId: string;
    readonly complete: boolean;
  },
) {
  const obsolete = await tx
    .select({ id: principalHistoryStages.id })
    .from(principalHistoryStages)
    .where(
      and(
        eq(principalHistoryStages.scopeId, current.scopeId),
        eq(principalHistoryStages.organizationId, current.organizationId),
        eq(principalHistoryStages.complete, false),
        ne(principalHistoryStages.id, current.id),
      ),
    )
    .orderBy(
      desc(principalHistoryStages.touchedAt),
      asc(principalHistoryStages.id),
    )
    // The writer always keeps its own stage, even when recency hints tie.
    .offset(INCOMPLETE_STAGE_LIMIT - (current.complete ? 0 : 1))
    .limit(RECLAIM_BATCH_LIMIT);
  const ids = obsolete.map(({ id }) => id);
  for (const id of ids) await releasePrincipalHistoryRoot(tx, `stage:${id}`);
  if (ids.length === 0) return;
  await tx
    .delete(principalHistoryStages)
    .where(inArray(principalHistoryStages.id, ids))
    .run();
}
