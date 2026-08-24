import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

async function openTestConnection(input: {
  dbName: string;
  key: string;
}): Promise<{
  close: () => void;
  runtime: ClientSQLitePersistenceRuntime;
}> {
  const db = await initTestSqliteDatabase({ ...input, cipher: "chacha20" });
  return {
    close: () => db.close(),
    runtime: createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }),
  };
}

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";

test("a stale metadata mutation cannot erase a hydrated creation timestamp", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "metadata-cas" });
  await sqlContainerContentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openTestConnection({ dbName, key: "metadata-cas" });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-1",
      metadataDocumentId: "metadata-1",
      name: "Container",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-1",
      id: container.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    };
    await sqlContainerContentsPersistence.saveContainer(
      first.runtime.execSql,
      container,
      record,
      {
        localUpdatedAt: T2,
        serverTimestamps: { createdAt: null, updatedAt: T2 },
      },
    );
    const staleState =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        container.id,
      );
    if (!staleState?.record) throw new Error("Expected stale metadata state");
    expect(staleState.container.serverCreatedAt).toBeNull();

    await sqlContainerContentsPersistence.saveContainer(
      second.runtime.execSql,
      staleState.container,
      staleState.record,
      {
        localUpdatedAt: T2,
        serverTimestamps: { createdAt: T1, updatedAt: T2 },
      },
    );

    const result = await sqlContainerContentsPersistence.commitMetadataMutation(
      first.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        container: { ...staleState.container, name: "Stale rename" },
        expectedContainer: staleState.container,
        expectedRecord: staleState.record,
        record: { ...staleState.record, metadataUpdates: "stale update" },
        saveOptions: { localUpdatedAt: T3 },
        settleAcceptedPendingOnConflict: false,
      },
    );

    expect(result).toMatchObject({
      committed: false,
      currentState: {
        container: { name: "Container", serverCreatedAt: T1 },
      },
    });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      container: { name: "Container", serverCreatedAt: T1 },
      record: { metadataUpdates: "" },
    });
  } finally {
    first.close();
    second.close();
  }
});
