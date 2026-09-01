import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  clientSqlTables,
  containerHydrationTombstones,
  dormantContainerMetadata,
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
    await db.insert(dormantContainerMetadata).values({
      containerId: "revoked-container",
      organizationId: "org-old",
      retainedAt: "2026-05-01T00:00:00.000Z",
    });

    await clearRemoteSyncState(execSql, { organizationId: "org-old" });

    expect(await db.select().from(containerHydrationTombstones)).toEqual([]);
  } finally {
    close();
  }
});
