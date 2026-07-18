import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
} from "../../data/sqlite/organizationDataUsageSchema";
import { clientSqlTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("remote reset deletes durable organization data usage", async () => {
  const { close, execSql } = await createTestExecSql(
    "remote-reset-organization-data-usage",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(organizationDataUsageSnapshots).values({
      organizationId: "org-1",
      requesterUserId: "user-1",
      projectionVersion: 1,
      blobCount: 1,
      blobByteLength: 10,
      documentByteLength: 20,
      documentCount: 1,
      documentUpdateCount: 2,
      totalByteLength: 30,
      refreshedAt: "2026-07-18T12:00:00.000Z",
    });
    await db.insert(organizationDataUsageCategories).values({
      organizationId: "org-1",
      requesterUserId: "user-1",
      category: "user",
      byteLength: 20,
      documentCount: 1,
      updateCount: 2,
    });

    await clearRemoteSyncState(execSql);

    expect(await db.select().from(organizationDataUsageSnapshots)).toEqual([]);
    expect(await db.select().from(organizationDataUsageCategories)).toEqual([]);
  } finally {
    close();
  }
});
