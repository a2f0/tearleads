import { and, asc, desc, eq, lt } from "drizzle-orm";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import { archivePrincipalHistoryKeyEnvelopes } from "./principalKeyEnvelopeArchivePersistence";

/** Each publication reclaims at most this many obsolete completed heads. */
export const PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT = 16;

export async function recordPrincipalHistoryStageScope(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly scopeId: string;
    readonly afterVersion: number;
    readonly complete: boolean;
  },
) {
  const row = { ...input, touchedAt: Date.now() };
  await tx
    .insert(principalHistoryStageScopes)
    .values(row)
    .onConflictDoUpdate({ target: principalHistoryStageScopes.id, set: row })
    .run();
}

/** The prefix and its key candidates must be published in this transaction. */
export async function reclaimCompletedPrincipalHistoryStages(
  tx: ClientSQLiteTransactionScope,
  prefix: {
    readonly scopeId: string;
    readonly organizationId: string;
    readonly version: number;
  },
) {
  const obsolete = await tx
    .select({ stage: principalHistoryStages })
    .from(principalHistoryStageScopes)
    .innerJoin(
      principalHistoryStages,
      eq(principalHistoryStageScopes.id, principalHistoryStages.id),
    )
    .where(
      and(
        eq(principalHistoryStageScopes.scopeId, prefix.scopeId),
        eq(principalHistoryStageScopes.organizationId, prefix.organizationId),
        eq(principalHistoryStageScopes.complete, true),
        lt(principalHistoryStageScopes.afterVersion, prefix.version),
        eq(principalHistoryStages.organizationId, prefix.organizationId),
        eq(principalHistoryStages.complete, true),
        lt(principalHistoryStages.afterVersion, prefix.version),
      ),
    )
    .orderBy(
      desc(principalHistoryStageScopes.afterVersion),
      desc(principalHistoryStageScopes.touchedAt),
      asc(principalHistoryStageScopes.id),
    )
    // Keep the current completed head and its newest completed predecessor.
    // This also preserves the prefix-only predecessor restored after an ack.
    .offset(2)
    .limit(PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT);
  for (const { stage } of obsolete) {
    await archivePrincipalHistoryKeyEnvelopes(tx, {
      ...stage,
      version: stage.afterVersion + 1,
    });
    await tx
      .delete(principalHistoryStages)
      .where(eq(principalHistoryStages.id, stage.id))
      .run();
    await tx
      .delete(principalHistoryStageScopes)
      .where(eq(principalHistoryStageScopes.id, stage.id))
      .run();
  }
}
