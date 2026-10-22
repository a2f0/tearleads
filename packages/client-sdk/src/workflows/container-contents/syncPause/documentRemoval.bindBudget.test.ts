import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import {
  clientSqlTables,
  containers,
  documents,
} from "../../../data/sqlite/schema";
import { remoteResetBatches } from "../../../data/sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../data/sqlite/sqlTableSchema";
import { listPendingWrites } from "../pendingWrites";
import { removeOrganizationContentUnlessPending } from "./documentRemoval";
import {
  bindBudgetedExecSql,
  placedDocument,
  preparePausedFolder,
  removeWithRealDeletion,
  UPDATED_AT,
} from "./documentRemoval.testFixtures";

async function withPausedFolder(
  run: (execSql: ExecSql, versions: readonly [string, string]) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("sync-pause-removal");
  try {
    await run(execSql, await preparePausedFolder(execSql));
  } finally {
    close();
  }
}

test("a folder with more documents than SQLite binds is removed", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    const localIds = Array.from(
      { length: 1_001 },
      (_, index) => `bulk-${index}`,
    );
    for (const localId of localIds) {
      await placedDocument(execSql, { localId, snapshotEndVersion: synced });
    }
    const boundedExecSql = bindBudgetedExecSql(execSql);

    const removal = await removeWithRealDeletion(boundedExecSql, ["folder"]);

    expect(removal.status).toBe("removed");
    expect(removal.deletedLocalIds).toHaveLength(localIds.length);
  });
});

test("a large organization is removed within SQLite's bind budget", async () => {
  const { close, execSql } = await createTestExecSql("sync-pause-removal-bulk");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await listPendingWrites(execSql);
    const containerIds = Array.from(
      { length: 1_001 },
      (_, index) => `bulk-folder-${index}`,
    );
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    for (const batch of remoteResetBatches(containerIds)) {
      await db.insert(containers).values(
        batch.map((id) => ({
          id,
          localCreatedAt: UPDATED_AT,
          localUpdatedAt: UPDATED_AT,
          metadataDocumentId: `metadata-${id}`,
          organizationId: "org-paused",
          parentId: null,
          serverCreatedAt: UPDATED_AT,
          serverUpdatedAt: UPDATED_AT,
        })),
      );
      await db.insert(documents).values(
        batch.map((id) => ({
          appKind: "container-metadata",
          documentId: `metadata-${id}`,
          localId: id,
          snapshotEndVersion: "",
          updatedAt: UPDATED_AT,
        })),
      );
    }
    const boundedExecSql = bindBudgetedExecSql(execSql);

    const removal = await removeOrganizationContentUnlessPending({
      containerIds,
      deleteContainers: (lockedExecSql, removals) =>
        sqlContainerContentsPersistence.deleteContainers(
          lockedExecSql,
          removals,
        ),
      documentProjectors: createDocumentProjectorRegistry([]),
      execSql: boundedExecSql,
      hasQueuedWrites: () => false,
      organizationId: "org-paused",
      restoreDocument: () => undefined,
      retireDocument: () => undefined,
      stillCurrent: () => true,
    });

    expect(removal.status).toBe("removed");
    expect(removal.deletedContainerIds).toHaveLength(containerIds.length);
    expect(boundedExecSql.maxBinds()).toBeLessThanOrEqual(999);
    expect(await db.select().from(containers)).toEqual([]);
  } finally {
    close();
  }
});
