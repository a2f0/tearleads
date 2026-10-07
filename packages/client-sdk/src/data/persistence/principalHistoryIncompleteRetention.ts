import { and, asc, desc, eq, ne } from "drizzle-orm";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

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
    .from(principalHistoryStageScopes)
    .innerJoin(
      principalHistoryStages,
      eq(principalHistoryStageScopes.id, principalHistoryStages.id),
    )
    .where(
      and(
        eq(principalHistoryStageScopes.scopeId, current.scopeId),
        eq(principalHistoryStageScopes.organizationId, current.organizationId),
        eq(principalHistoryStageScopes.complete, false),
        eq(principalHistoryStages.organizationId, current.organizationId),
        eq(principalHistoryStages.complete, false),
        ne(principalHistoryStageScopes.id, current.id),
      ),
    )
    .orderBy(
      desc(principalHistoryStageScopes.touchedAt),
      asc(principalHistoryStageScopes.id),
    )
    // The writer always keeps its own stage, even when recency hints tie.
    .offset(INCOMPLETE_STAGE_LIMIT - (current.complete ? 0 : 1))
    .limit(RECLAIM_BATCH_LIMIT);
  for (const { id } of obsolete) {
    await tx
      .delete(principalHistoryStages)
      .where(eq(principalHistoryStages.id, id))
      .run();
    await tx
      .delete(principalHistoryStageScopes)
      .where(eq(principalHistoryStageScopes.id, id))
      .run();
  }
}
