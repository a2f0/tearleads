import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  clientSqlTables,
  containerDocumentTombstoneHolds,
  containers,
  documentContainerProjection,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("remote reset clears tombstone holds with the link rows they hide", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-tombstone-holds",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const stale = "2026-05-01T00:00:00.000Z";
    await db.insert(containers).values({
      id: "child",
      organizationId: "org-old",
      parentId: null,
      metadataDocumentId: null,
      systemSlot: null,
      localCreatedAt: stale,
      localUpdatedAt: stale,
      serverCreatedAt: stale,
      serverUpdatedAt: stale,
    });
    await db.insert(documentContainerProjection).values({
      containerId: "child",
      documentId: "doc-remote-old",
      updatedAt: stale,
    });
    await db.insert(containerDocumentTombstoneHolds).values({
      containerId: "child",
      documentId: "doc-remote-old",
      tombstonedAt: stale,
      updatedAt: stale,
    });

    await clearRemoteSyncState(execSql, { organizationId: "org-old" });

    expect(await db.select().from(containerDocumentTombstoneHolds)).toEqual([]);
    expect(await db.select().from(documentContainerProjection)).toEqual([]);
  } finally {
    close();
  }
});
