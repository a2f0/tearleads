import { createTestExecSql } from "@tearleads/test-utils";
import { asc } from "drizzle-orm";
import { reclaimIncompletePrincipalHistoryStages } from "../../src/data/persistence/principalHistory/principalHistoryIncompleteRetention";
import { reclaimCompletedPrincipalHistoryStages } from "../../src/data/persistence/principalHistory/principalHistoryStageRetention";
import { reclaimUnpublishedPrincipalHistoryStages } from "../../src/data/persistence/principalHistory/principalHistoryUnpublishedRetention";
import {
  principalHistoryEvidenceTables,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../src/data/sqlite/schema/principalHistoryEvidenceSchema";
import { principalKeyEnvelopeArchive } from "../../src/data/sqlite/schema/principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../../src/data/sqlite/schema/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  ensureSqlTables,
} from "../../src/data/sqlite/sqlSchema";

export type RetentionPass = "incomplete" | "completed" | "unpublished";

export async function retentionBatchFixture(
  pass: RetentionPass,
  obsolete: number,
  currentJson = "{}",
) {
  const f = await createTestExecSql("principal-retention-batch");
  const statements: { sql: string; binds: number }[] = [];
  const fault = { afterSql: (_sql: string) => {} };
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      statements.push({ sql, binds: Object.keys(bind ?? {}).length });
      const rows = await f.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      fault.afterSql(sql);
      return { rows };
    },
  });
  await ensureSqlTables(execSql, [
    ...principalHistoryStageTables,
    ...principalHistoryEvidenceTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const { db } = runtime;
  const scope = { scopeId: "scope-1", organizationId: "org-1" };
  const retained = pass === "completed" ? 2 : 8;
  const stage = {
    ...scope,
    currentJson,
    afterVersion: 0,
    complete: pass !== "incomplete",
    progress: "opaque-progress",
    rootHash: "shared-root",
  };
  const rows = Array.from({ length: obsolete + retained }, (_, index) => ({
    ...stage,
    id: `stage-${String(index).padStart(3, "0")}`,
    touchedAt: index,
  }));
  await db.insert(principalHistoryStages).values(rows);
  await db.insert(principalHistoryNodes).values({
    ...scope,
    hash: stage.rootHash,
    referenceCount: obsolete + retained + 1,
    managed: false,
  });
  const current = {
    ...scope,
    id: rows.at(-1)?.id ?? "current",
    complete: stage.complete,
  };
  const run = () =>
    runtime.guardedTransaction(
      async (tx) => {
        if (pass === "incomplete")
          await reclaimIncompletePrincipalHistoryStages(tx, current);
        else if (pass === "completed")
          await reclaimCompletedPrincipalHistoryStages(tx, {
            ...scope,
            version: 1,
          });
        else await reclaimUnpublishedPrincipalHistoryStages(tx, current);
      },
      () => true,
      { behavior: "immediate" },
    );
  const snapshot = async () => ({
    stages: await db
      .select()
      .from(principalHistoryStages)
      .orderBy(asc(principalHistoryStages.id)),
    nodes: await db
      .select()
      .from(principalHistoryNodes)
      .orderBy(
        asc(principalHistoryNodes.scopeId),
        asc(principalHistoryNodes.hash),
      ),
    archives: await db
      .select()
      .from(principalKeyEnvelopeArchive)
      .orderBy(
        asc(principalKeyEnvelopeArchive.organizationId),
        asc(principalKeyEnvelopeArchive.keyFingerprint),
      ),
    prefixes: await db
      .select()
      .from(principalHistoryPrefixes)
      .orderBy(asc(principalHistoryPrefixes.scopeId)),
  });
  statements.length = 0;
  return {
    ...f,
    execSql,
    runtime,
    db,
    scope,
    stage,
    rows,
    current,
    retained,
    statements,
    fault,
    run,
    snapshot,
  };
}
