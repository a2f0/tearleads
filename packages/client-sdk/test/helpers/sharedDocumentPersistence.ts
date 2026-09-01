import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../src/data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../src/data/sqlite/sqlSchema";

export async function openSharedDocumentPersistenceConnections(key: string) {
  const dbName = `/${crypto.randomUUID()}.db`;
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName,
    key,
  });
  let transactionOwner: symbol | null = null;
  let transactionReleased: Promise<void> = Promise.resolve();
  let releaseTransaction = () => {};
  const createRuntime = (): ClientSQLitePersistenceRuntime => {
    const owner = Symbol("pane-executor");
    return createClientSQLitePersistenceRuntime({
      exec: async (options) => {
        const command = options.sql.trimStart().toUpperCase();
        const beginsTransaction = command.startsWith("BEGIN");
        const endsTransaction =
          command.startsWith("COMMIT") || command.startsWith("ROLLBACK");
        if (beginsTransaction) {
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
          return {
            rows: execDatabaseStatement(db, options) as Array<
              SqlRow | SqlArrayRow
            >,
          };
        } finally {
          if (endsTransaction && transactionOwner === owner) {
            transactionOwner = null;
            releaseTransaction();
          }
        }
      },
    });
  };
  const first = { runtime: createRuntime() };
  await sqlDocumentsPersistence.ensureSchema(first.runtime.execSql);
  const second = { runtime: createRuntime() };
  return { close: () => db.close(), first, second };
}
