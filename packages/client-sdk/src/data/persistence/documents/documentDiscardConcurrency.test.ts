import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import { defaultDocumentProjectorRegistry } from "../../documents/documentKinds";
import { createClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";

async function openDiscardRaceConnections() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "document-discard-race",
  });
  let pauseNextBegin = false;
  let beginReached = Promise.resolve();
  let signalBeginReached = () => {};
  let beginReleased = Promise.resolve();
  let releaseBegin = () => {};
  const stale = createClientSQLitePersistenceRuntime({
    exec: async (options) => {
      if (
        pauseNextBegin &&
        options.sql.trimStart().toUpperCase().startsWith("BEGIN")
      ) {
        pauseNextBegin = false;
        signalBeginReached();
        await beginReleased;
      }
      return {
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      };
    },
  });
  const replacement = createClientSQLitePersistenceRuntime({
    exec: async (options) => ({
      rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
    }),
  });
  await sqlDocumentsPersistence.ensureSchema(stale.execSql);
  return {
    armStaleBegin() {
      pauseNextBegin = true;
      beginReached = new Promise<void>((resolve) => {
        signalBeginReached = resolve;
      });
      beginReleased = new Promise<void>((resolve) => {
        releaseBegin = resolve;
      });
      return { beginReached, releaseBegin };
    },
    close: () => db.close(),
    replacement,
    stale,
  };
}

test("discard refuses a replacement identity committed before its transaction", async () => {
  const race = await openDiscardRaceConnections();
  let releasePausedBegin = () => {};
  const localId = "local-document";
  try {
    await sqlDocumentsPersistence.saveDocument(race.stale.execSql, {
      accessEpoch: 1,
      containerId: "container-a",
      documentId: "old-document",
      id: localId,
      snapshotEndVersion: "old-frontier",
      text: "replacement-worthy content",
    });
    const { beginReached, releaseBegin } = race.armStaleBegin();
    releasePausedBegin = releaseBegin;
    const staleDiscard = sqlDocumentsPersistence.discardDocumentToShell?.(
      race.stale.execSql,
      localId,
      "old-document",
      defaultDocumentProjectorRegistry,
    );
    if (!staleDiscard) throw new Error("SQL discard operation is unavailable");
    await beginReached;

    await sqlDocumentsPersistence.relinkPersistedDocument(
      race.replacement.execSql,
      {
        accessEpoch: 2,
        containerId: "container-b",
        documentId: "replacement-document",
        localId,
      },
    );
    releaseBegin();

    await expect(staleDiscard).resolves.toEqual({ discarded: false });
    await expect(
      sqlDocumentsPersistence.loadDocument(race.replacement.execSql, localId),
    ).resolves.toMatchObject({
      accessEpoch: 2,
      containerId: "container-b",
      documentId: "replacement-document",
      snapshotEndVersion: "old-frontier",
      text: "replacement-worthy content",
    });
  } finally {
    releasePausedBegin();
    race.close();
  }
});
