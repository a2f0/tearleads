import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { sqlNotesPersistence } from "./notesPersistence";

async function createExecSql() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch;

  let db: Awaited<ReturnType<typeof initDatabase>>;
  try {
    db = await initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "notes-persistence-test",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  return {
    close: () => db.close(),
    execSql: async (
      sql: string,
      bind?: Record<string, string | number | null>,
    ) => execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
  };
}

test("concurrent note saves are serialized on a shared SQLite connection", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await expect(
      Promise.all([
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          documentId: null,
          text: "first",
          loroSnapshot: "snapshot-1",
          accessEpoch: 1,
        }),
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          documentId: null,
          text: "second",
          loroSnapshot: "snapshot-2",
          accessEpoch: 2,
        }),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    await expect(
      sqlNotesPersistence.loadNote(execSql, "default"),
    ).resolves.toEqual({
      id: "default",
      documentId: null,
      text: "second",
      loroSnapshot: "snapshot-2",
      accessEpoch: 2,
    });
  } finally {
    close();
  }
});
