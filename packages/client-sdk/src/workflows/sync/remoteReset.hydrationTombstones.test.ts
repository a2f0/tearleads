import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  clientSqlTables,
  containerHydrationTombstones,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("remote reset clears container hydration tombstones", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-hydration-tombstones",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(containerHydrationTombstones).values({
      containerId: "revoked-container",
      reason: "access_revoked",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    await clearRemoteSyncState(execSql);

    expect(await db.select().from(containerHydrationTombstones)).toEqual([]);
  } finally {
    close();
  }
});
