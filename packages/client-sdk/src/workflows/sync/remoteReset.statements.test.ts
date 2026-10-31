import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { asc } from "drizzle-orm";
import { countingExecSql } from "../../../test/helpers/statementCounting";
import {
  clientSqlTables,
  containers,
  documents,
} from "../../data/sqlite/schema";
import { remoteResetBatches } from "../../data/sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const organizationId = "statement-reset-old-organization";
const rootId = "statement-reset-local-root";
const timestamp = "2026-10-30T00:00:00.000Z";

async function resetFixture(childCount: number) {
  const sqlite = await createTestExecSql(
    `remote-reset-statements-${childCount}`,
  );
  const childIds = Array.from(
    { length: childCount },
    (_, index) => `statement-reset-child-${index}`,
  );
  await ensureSqlTables(sqlite.execSql, clientSqlTables);
  const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
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
      batch.map((localId, index) => ({
        appKind: "container-metadata",
        localId,
        // Every other row was already reset once: no server id, only the
        // recovery id it kept.
        documentId: index % 2 === 0 ? `remote-metadata-${localId}` : null,
        recoveryDocumentId: index % 2 === 0 ? null : `recovered-${localId}`,
        snapshotEndVersion: "",
        updatedAt: timestamp,
      })),
    );
  }
  return { ...sqlite, childIds, db };
}

test("remote reset rewrites server identity once per batch", async () => {
  const counts: Record<string, number> = {};
  for (const childCount of [1, 51, 101]) {
    const f = await resetFixture(childCount);
    try {
      const counted = countingExecSql(f.execSql);
      // Warm the per-connection schema ensure so it is not counted.
      await ensureSqlTables(counted.execSql, clientSqlTables);
      counts[`children${childCount}`] = await counted.count(() =>
        clearRemoteSyncState(counted.execSql, {
          organizationId,
          replacement: {
            organizationId: "statement-reset-new-organization",
            rootContainerId: "statement-reset-new-root",
          },
        }),
      );
      // COALESCE keeps each row's own value: only the root is re-homed, and
      // each document keeps the id it had (server id, else its recovery id).
      const containerRows = await f.db
        .select({ id: containers.id, parentId: containers.parentId })
        .from(containers)
        .orderBy(asc(containers.id));
      expect(containerRows).toEqual(
        [rootId, ...f.childIds].sort().map((id) => ({
          id,
          parentId: id === rootId ? "statement-reset-new-root" : rootId,
        })),
      );
      const documentRows = await f.db
        .select({
          documentId: documents.documentId,
          localId: documents.localId,
          recoveryDocumentId: documents.recoveryDocumentId,
        })
        .from(documents);
      expect(
        documentRows.sort((a, b) => a.localId.localeCompare(b.localId)),
      ).toEqual(
        f.childIds
          .map((localId, index) => ({
            documentId: null,
            localId,
            recoveryDocumentId:
              index % 2 === 0
                ? `remote-metadata-${localId}`
                : `recovered-${localId}`,
          }))
          .sort((a, b) => a.localId.localeCompare(b.localId)),
      );
    } finally {
      f.close();
    }
  }
  // One containers update and one documents update per 50-row batch; the
  // per-row updates took 59 / 170 / 283 statements. Folding node liveness and
  // policy ownership into their tables saved one read and one delete (was
  // 58 / 71 / 86).
  expect(counts).toEqual({ children1: 56, children51: 69, children101: 84 });
});
