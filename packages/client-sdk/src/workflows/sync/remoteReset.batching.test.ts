import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  clientSqlTables,
  containerCreateIntents,
  containers,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";
import {
  REMOTE_RESET_SQL_BATCH_SIZE,
  remoteResetBatches,
} from "./remoteResetBatches";

test("remote reset batches organizations beyond SQLite bind limits", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-batching-test",
  );
  const organizationId = "batch-reset-old-organization";
  const rootId = "batch-reset-local-root";
  const timestamp = "2026-08-29T00:00:00.000Z";
  const childCount = REMOTE_RESET_SQL_BATCH_SIZE * 2 + 1;
  const childIds = Array.from(
    { length: childCount },
    (_, index) => `batch-reset-child-${index}`,
  );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    for (const batch of remoteResetBatches([rootId, ...childIds])) {
      await db.insert(containers).values(
        batch.map((id) => ({
          id,
          organizationId,
          parentId: id === rootId ? null : rootId,
          metadataDocumentId: `remote-metadata-${id}`,
          systemSlot: id === rootId ? "root" : null,
          localCreatedAt: timestamp,
          localUpdatedAt: timestamp,
          serverCreatedAt: timestamp,
          serverUpdatedAt: timestamp,
        })),
      );
    }
    for (const batch of remoteResetBatches(childIds)) {
      await db.insert(documents).values(
        batch.map((localId) => ({
          appKind: "container-metadata",
          localId,
          documentId: `remote-metadata-${localId}`,
          snapshotEndVersion: "",
          updatedAt: timestamp,
        })),
      );
    }

    const bindCounts: number[] = [];
    const boundedExecSql = new Proxy(execSql, {
      apply(target, thisArg, args) {
        const bind = args[1];
        const bindCount = Array.isArray(bind)
          ? bind.length
          : bind && typeof bind === "object"
            ? Object.keys(bind).length
            : 0;
        bindCounts.push(bindCount);
        if (bindCount > 999) {
          throw new Error(`SQLite bind limit exceeded: ${bindCount}`);
        }
        return Reflect.apply(target, thisArg, args);
      },
    });

    const result = await clearRemoteSyncState(boundedExecSql, {
      organizationId,
      replacement: {
        organizationId: "batch-reset-new-organization",
        rootContainerId: "batch-reset-new-root",
      },
    });

    expect(result.resetContainerCount).toBe(childCount + 1);
    expect(result.resetDocumentCount).toBe(childCount);
    expect(result.queuedContainerCreateCount).toBe(childCount + 1);
    expect(Math.max(...bindCounts)).toBeLessThanOrEqual(999);
    expect(await db.select().from(containerCreateIntents)).toHaveLength(
      childCount + 1,
    );
    expect(
      (await db.select().from(documents)).every(
        (row) => row.documentId === null,
      ),
    ).toBe(true);
  } finally {
    close();
  }
});
