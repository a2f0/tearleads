import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { createClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import { refuseDeletedDocumentPersist } from "./documentPersistGuards";

async function openDocumentRaceConnections() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "document-delete-create-race",
  });
  let transactionOwner: symbol | null = null;
  let transactionReleased: Promise<void> = Promise.resolve();
  let releaseTransaction = () => {};
  let releaseAbsentRead = () => {};
  const absentReadReleased = new Promise<void>((resolve) => {
    releaseAbsentRead = resolve;
  });
  let signalAbsentRead = () => {};
  const absentRead = new Promise<void>((resolve) => {
    signalAbsentRead = resolve;
  });
  let signalCreateBegin = () => {};
  const createBegin = new Promise<void>((resolve) => {
    signalCreateBegin = resolve;
  });

  const createRuntime = (role: "cleanup" | "create") => {
    const owner = Symbol(role);
    let didPauseAbsentRead = false;
    return createClientSQLitePersistenceRuntime({
      exec: async (options) => {
        const command = options.sql.trimStart().toUpperCase();
        const beginsTransaction = command.startsWith("BEGIN");
        const endsTransaction =
          command.startsWith("COMMIT") || command.startsWith("ROLLBACK");
        if (beginsTransaction) {
          if (role === "create") signalCreateBegin();
          while (transactionOwner !== null && transactionOwner !== owner) {
            await transactionReleased;
          }
          if (transactionOwner === null) {
            transactionOwner = owner;
            transactionReleased = new Promise<void>((resolve) => {
              releaseTransaction = resolve;
            });
          }
        } else {
          while (transactionOwner !== null && transactionOwner !== owner) {
            await transactionReleased;
          }
        }
        try {
          const rows = execDatabaseStatement(db, options) as Array<
            SqlRow | SqlArrayRow
          >;
          if (
            role === "cleanup" &&
            !didPauseAbsentRead &&
            command.startsWith("SELECT") &&
            command.includes('FROM "DOCUMENTS"')
          ) {
            didPauseAbsentRead = true;
            signalAbsentRead();
            await absentReadReleased;
          }
          return { rows };
        } finally {
          if (endsTransaction && transactionOwner === owner) {
            transactionOwner = null;
            releaseTransaction();
          }
        }
      },
    });
  };
  const cleanup = createRuntime("cleanup");
  await sqlDocumentsPersistence.ensureSchema(cleanup.execSql);
  return {
    absentRead,
    cleanup,
    close: () => db.close(),
    create: createRuntime("create"),
    createBegin,
    releaseAbsentRead,
  };
}

test("an initializer racing absent-row cleanup keeps its new document", async () => {
  const race = await openDocumentRaceConnections();
  const localId = "racing-document";
  let clientProjectionDeletes = 0;
  const documentProjectors = createDocumentProjectorRegistry([
    {
      clientProjection: {
        delete: () => {
          clientProjectionDeletes += 1;
        },
        save: () => undefined,
        tables: [],
      },
      kind: "contact",
    },
  ]);
  try {
    const cleanup = refuseDeletedDocumentPersist({
      currentRecord: {
        accessEpoch: 1,
        containerId: "stale-container",
        documentId: "stale-document",
        documentKind: "contact",
        id: localId,
        snapshotEndVersion: "stale-version",
        text: "stale",
      },
      documentProjectors,
      execSql: race.cleanup.execSql,
      localId,
      persistence: sqlDocumentsPersistence,
    });
    await race.absentRead;

    const create = sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      race.create.execSql,
      {
        accessEpoch: 1,
        containerId: "fresh-container",
        documentId: "fresh-document",
        id: localId,
        snapshotEndVersion: "fresh-version",
        text: "fresh",
      },
      { endVersionVector: "fresh-version", snapshot: "fresh-snapshot" },
      undefined,
      async () => undefined,
    );
    await race.createBegin;
    race.releaseAbsentRead();

    expect(await cleanup).toBe(true);
    expect(await create).not.toBeNull();
    expect(clientProjectionDeletes).toBe(1);
    expect(
      await sqlDocumentsPersistence.loadDocument(race.create.execSql, localId),
    ).toMatchObject({ documentId: "fresh-document", text: "fresh" });
  } finally {
    race.releaseAbsentRead();
    race.close();
  }
});
