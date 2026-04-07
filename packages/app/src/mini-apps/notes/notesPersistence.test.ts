import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import {
  listNotesByContainerIds,
  sqlNotesPersistence,
} from "./notesPersistence";

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
          documentRecipientEnvelopes: null,
          text: "first",
          loroSnapshot: "snapshot-1",
          accessEpoch: 1,
        }),
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          containerId: "root-container",
          documentId: null,
          documentRecipientEnvelopes: null,
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
      documentRecipientEnvelopes: null,
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
      documentRecipientEnvelopes: null,
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
      documentRecipientEnvelopes: null,
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

test("listNotesByContainerIds only returns notes for the requested containers", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-a",
      containerId: "container-a",
      documentId: "document-a",
      documentRecipientEnvelopes: null,
      text: "Note A",
      loroSnapshot: "snapshot-a",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-b",
      containerId: "container-b",
      documentId: "document-b",
      documentRecipientEnvelopes: null,
      text: "Note B",
      loroSnapshot: "snapshot-b",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-c",
      containerId: "container-c",
      documentId: "document-c",
      documentRecipientEnvelopes: null,
      text: "Note C",
      loroSnapshot: "snapshot-c",
      accessEpoch: 1,
    });

    await expect(
      listNotesByContainerIds(execSql, ["container-a", "container-c"]),
    ).resolves.toEqual([
      {
        id: "note-c",
        containerId: "container-c",
        documentId: "document-c",
        title: "Note C",
        updatedAt: expect.any(String),
      },
      {
        id: "note-a",
        containerId: "container-a",
        documentId: "document-a",
        title: "Note A",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});
