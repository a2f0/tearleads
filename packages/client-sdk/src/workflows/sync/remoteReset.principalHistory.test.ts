import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { clientSqlTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("organization reset discards only its principal history stages and evidence", async () => {
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
    for (const organizationId of ["org-1", "org-2"]) {
      const scope = { organizationId, scopeId: `scope-${organizationId}` };
      await db
        .insert(principalHistoryPrefixes)
        .values({
          ...scope,
          version: 66,
          headJson: "{}",
          progress: "opaque-prefix",
        })
        .run();
      await db
        .insert(principalHistoryEntries)
        .values({ ...scope, leafHash: "leaf-hash", entryJson: "{}" })
        .run();
      await db
        .insert(principalHistoryNodes)
        .values({
          ...scope,
          hash: "node-hash",
          leftHash: "left",
          rightHash: "right",
        })
        .run();
    }
    await clearRemoteSyncState(execSql, { organizationId: "org-1" });
    expect(
      await db
        .select({ organizationId: principalHistoryStages.organizationId })
        .from(principalHistoryStages),
    ).toEqual([{ organizationId: "org-2" }]);
    for (const table of [
      principalHistoryPrefixes,
      principalHistoryEntries,
      principalHistoryNodes,
    ])
      expect(
        await db.select({ organizationId: table.organizationId }).from(table),
      ).toEqual([{ organizationId: "org-2" }]);
  } finally {
    close();
  }
});
