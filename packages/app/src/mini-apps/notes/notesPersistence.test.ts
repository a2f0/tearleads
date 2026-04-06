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
          containerId: "root-container",
          documentId: null,
          text: "first",
          loroSnapshot: "snapshot-1",
          accessEpoch: 1,
        }),
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          containerId: "root-container",
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
      containerId: "root-container",
      documentId: null,
      text: "second",
      loroSnapshot: "snapshot-2",
      accessEpoch: 2,
    });
  } finally {
    close();
  }
});

test("upsertDiscoveredNote reuses an existing local note bound to the remote document id", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "local-note",
      containerId: "shared-container",
      documentId: "remote-document",
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 2,
    });

    await expect(
      sqlNotesPersistence.upsertDiscoveredNote(execSql, {
        accessEpoch: 3,
        containerId: "shared-container",
        createdAt: "2026-04-06T00:00:00.000Z",
        documentId: "remote-document",
      }),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "shared-container",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-06T00:00:00.000Z",
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "shared-container",
      documentId: "remote-document",
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "remote-document"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
