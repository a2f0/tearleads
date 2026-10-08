import { and, asc, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { principalHistoryPrefixes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import { releasePrincipalHistoryRoot } from "./principalHistoryRootOwnership";
import { PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT } from "./principalHistoryStageRetention";
import { archivePrincipalHistoryKeyEnvelopes } from "./principalKeyEnvelopeArchivePersistence";

const COMPLETED_STAGE_LIMIT = 8;

interface CompletedWriter {
  readonly id: string;
  readonly scopeId: string;
  readonly organizationId: string;
  readonly complete: boolean;
}

function matchingCompletedStages(current: CompletedWriter) {
  return and(
    eq(principalHistoryStageScopes.scopeId, current.scopeId),
    eq(principalHistoryStageScopes.organizationId, current.organizationId),
    eq(principalHistoryStageScopes.complete, true),
    eq(principalHistoryStages.organizationId, current.organizationId),
    eq(principalHistoryStages.complete, true),
    eq(
      principalHistoryStages.afterVersion,
      principalHistoryStageScopes.afterVersion,
    ),
  );
}

async function protectedPublishedStages(
  tx: ClientSQLiteTransactionScope,
  current: CompletedWriter,
) {
  const [prefix] = await tx
    .select({ version: principalHistoryPrefixes.version })
    .from(principalHistoryPrefixes)
    .where(
      and(
        eq(principalHistoryPrefixes.scopeId, current.scopeId),
        eq(principalHistoryPrefixes.organizationId, current.organizationId),
      ),
    )
    .limit(1);
  if (!prefix) return [];
  return tx
    .select({ id: principalHistoryStages.id })
    .from(principalHistoryStageScopes)
    .innerJoin(
      principalHistoryStages,
      eq(principalHistoryStageScopes.id, principalHistoryStages.id),
    )
    .where(
      and(
        matchingCompletedStages(current),
        lt(principalHistoryStageScopes.afterVersion, prefix.version),
      ),
    )
    .orderBy(
      desc(principalHistoryStageScopes.afterVersion),
      desc(principalHistoryStageScopes.touchedAt),
      asc(principalHistoryStageScopes.id),
    )
    .limit(2);
}

/** Bound completed attempts even when current-artifact verification never publishes. */
export async function reclaimUnpublishedPrincipalHistoryStages(
  tx: ClientSQLiteTransactionScope,
  current: CompletedWriter,
) {
  if (!current.complete) return;
  const published = await protectedPublishedStages(tx, current);
  const protectedIds = [
    ...new Set([current.id, ...published.map(({ id }) => id)]),
  ];
  const obsolete = await tx
    .select({
      stage: {
        id: principalHistoryStages.id,
        organizationId: principalHistoryStages.organizationId,
        currentJson: principalHistoryStages.currentJson,
        afterVersion: principalHistoryStages.afterVersion,
      },
    })
    .from(principalHistoryStageScopes)
    .innerJoin(
      principalHistoryStages,
      eq(principalHistoryStageScopes.id, principalHistoryStages.id),
    )
    .where(
      and(
        matchingCompletedStages(current),
        notInArray(principalHistoryStages.id, protectedIds),
      ),
    )
    // The existing "incomplete" index also covers completed scoped recency.
    .orderBy(
      desc(principalHistoryStageScopes.touchedAt),
      asc(principalHistoryStageScopes.id),
    )
    .offset(COMPLETED_STAGE_LIMIT - protectedIds.length)
    .limit(PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT);
  if (obsolete.length === 0) return;
  for (const { stage } of obsolete)
    await archivePrincipalHistoryKeyEnvelopes(tx, {
      ...stage,
      version: stage.afterVersion + 1,
    });
  const ids = obsolete.map(({ stage }) => stage.id);
  for (const id of ids) await releasePrincipalHistoryRoot(tx, `stage:${id}`);
  await tx
    .delete(principalHistoryStages)
    .where(inArray(principalHistoryStages.id, ids))
    .run();
  await tx
    .delete(principalHistoryStageScopes)
    .where(inArray(principalHistoryStageScopes.id, ids))
    .run();
}
