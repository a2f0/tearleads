import { createTestExecSql } from "@tearleads/test-utils";
import { asc } from "drizzle-orm";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../../src/data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStageScopes } from "../../src/data/sqlite/principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../../src/data/sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../src/data/sqlite/sqlSchema";

/** Opaque rows exercise eviction; cryptographic recovery is tested separately. */
export async function seededCompletedRetention(
  count: number,
  prefixVersion?: number,
) {
  const f = await createTestExecSql("principal-completed-retention");
  await ensureSqlTables(f.execSql, [
    ...principalHistoryStageTables,
    ...principalHistoryEvidenceTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(f.execSql);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `old-${index}`,
    organizationId: "org-1",
    currentJson: "{}",
    afterVersion: index,
    complete: true,
    progress: `progress-${index}`,
  }));
  await db.insert(principalHistoryStages).values(rows);
  await db.insert(principalHistoryStageScopes).values(
    rows.map((row, index) => ({
      ...row,
      scopeId: "scope-1",
      touchedAt: Number.MAX_SAFE_INTEGER - count + index,
    })),
  );
  if (prefixVersion !== undefined)
    await db.insert(principalHistoryPrefixes).values({
      scopeId: "scope-1",
      organizationId: "org-1",
      version: prefixVersion,
      currentJson: "{}",
      headJson: "{}",
      progress: "published-prefix",
    });
  return {
    ...f,
    db,
    rows,
    input: {
      execSql: f.execSql,
      stage: {
        id: "current",
        organizationId: "org-1",
        currentJson: "{}",
        afterVersion: 99,
        complete: true,
        progress: "current-progress",
      },
      previousProgress: null,
      evidence: {
        indexRootHash: "opaque-index-root",
        scopeId: "scope-1",
        organizationId: "org-1",
        entries: [],
        nodes: [],
      },
      stillCurrent: () => true,
    },
    snapshot: async () => ({
      stages: await db
        .select()
        .from(principalHistoryStages)
        .orderBy(asc(principalHistoryStages.id)),
      hints: await db
        .select()
        .from(principalHistoryStageScopes)
        .orderBy(asc(principalHistoryStageScopes.id)),
      prefixes: await db.select().from(principalHistoryPrefixes),
    }),
  };
}
