import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { clientSqlTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("organization reset discards only its provisional principal history stages", async () => {
  const { execSql, close } = await createTestExecSql("reset-principal-history");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db
      .insert(principalHistoryStages)
      .values(
        ["org-1", "org-2"].map((organizationId) => ({
          id: `stage-${organizationId}`,
          organizationId,
          currentJson: "{}",
          afterVersion: 32,
          complete: false,
          progress: "opaque-authenticated-progress",
        })),
      )
      .run();
    await clearRemoteSyncState(execSql, { organizationId: "org-1" });
    expect(
      await db
        .select({ organizationId: principalHistoryStages.organizationId })
        .from(principalHistoryStages),
    ).toEqual([{ organizationId: "org-2" }]);
  } finally {
    close();
  }
});
