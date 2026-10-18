import { and, asc, desc, eq, lt } from "drizzle-orm";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { archivePrincipalHistoryKeyEnvelopes } from "../principalKeys/principalKeyEnvelopeArchivePersistence";
import { releasePrincipalHistoryRoot } from "./principalHistoryRootOwnership";

/** Each publication reclaims at most this many obsolete completed heads. */
export const PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT = 16;

/** Mark a stored stage as just used by a writer for its principal history. */
export async function touchPrincipalHistoryStage(
  tx: ClientSQLiteTransactionScope,
  input: { readonly id: string; readonly scopeId: string },
) {
  await tx
    .update(principalHistoryStages)
    .set({ scopeId: input.scopeId, touchedAt: Date.now() })
    .where(eq(principalHistoryStages.id, input.id))
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
    .select({
      stage: {
        id: principalHistoryStages.id,
        organizationId: principalHistoryStages.organizationId,
        currentJson: principalHistoryStages.currentJson,
        afterVersion: principalHistoryStages.afterVersion,
      },
    })
    .from(principalHistoryStages)
    .where(
      and(
        eq(principalHistoryStages.scopeId, prefix.scopeId),
        eq(principalHistoryStages.organizationId, prefix.organizationId),
        eq(principalHistoryStages.complete, true),
        lt(principalHistoryStages.afterVersion, prefix.version),
      ),
    )
    .orderBy(
      desc(principalHistoryStages.afterVersion),
      desc(principalHistoryStages.touchedAt),
      asc(principalHistoryStages.id),
    )
    // Keep the current completed head and its newest completed predecessor.
    // This also preserves the prefix-only predecessor restored after an ack.
    .offset(2)
    .limit(PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT);
  for (const { stage } of obsolete) {
    await releasePrincipalHistoryRoot(tx, `stage:${stage.id}`);
    await archivePrincipalHistoryKeyEnvelopes(tx, {
      ...stage,
      version: stage.afterVersion + 1,
    });
    await tx
      .delete(principalHistoryStages)
      .where(eq(principalHistoryStages.id, stage.id))
      .run();
  }
}
