import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../sqlite/sqlSchema";
import { savePrincipalHistoryPrefix } from "./principalHistoryPrefixPersistence";
import { PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT } from "./principalHistoryStageRetention";

test("completed-stage cleanup is bounded and preserves incomplete, newer and foreign progress", async () => {
  const f = await createTestExecSql("bounded-principal-stage-cleanup");
  const count = PRINCIPAL_HISTORY_STAGE_RECLAIM_LIMIT + 3;
  try {
    await ensureSqlTables(f.execSql, principalHistoryStageTables);
    const { db } = getClientSQLitePersistenceRuntime(f.execSql);
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `old-${index}`,
      organizationId: "org-1",
      afterVersion: index,
      complete: true,
      currentJson: "{}",
      progress: "opaque-test-progress",
    }));
    const first = rows[0];
    if (!first) throw new Error("Missing stage fixture");
    const retained = [
      { ...first, id: "incomplete", complete: false },
      { ...first, id: "newer", afterVersion: 99 },
      { ...first, id: "foreign-scope" },
      { ...first, id: "foreign-organization", organizationId: "org-2" },
    ];
    await db.insert(principalHistoryStages).values([...rows, ...retained]);
    await db.insert(principalHistoryStageScopes).values(
      [...rows, ...retained].map((row) => ({
        id: row.id,
        afterVersion: row.afterVersion,
        complete: row.complete,
        organizationId: row.organizationId,
        scopeId: row.id === "foreign-scope" ? "scope-2" : "scope-1",
        touchedAt: 1,
      })),
    );
    const input = {
      indexRootHash: "opaque-index-root",
      execSql: f.execSql,
      stillCurrent: () => true,
      prefix: {
        scopeId: "scope-1",
        organizationId: "org-1",
        version: 40,
        currentJson: "{}",
        headJson: "{}",
        progress: "opaque-prefix",
      },
    };
    await savePrincipalHistoryPrefix(input);
    expect(await db.select().from(principalHistoryStages)).toHaveLength(7);
    expect(await db.select().from(principalHistoryStageScopes)).toHaveLength(7);
    await savePrincipalHistoryPrefix(input);
    expect(
      (await db.select().from(principalHistoryStages))
        .map((row) => row.id)
        .sort(),
    ).toEqual(
      [
        ...retained.map((row) => row.id),
        `old-${count - 2}`,
        `old-${count - 1}`,
      ].sort(),
    );
    expect(await db.select().from(principalHistoryStageScopes)).toHaveLength(6);
  } finally {
    f.close();
  }
});
