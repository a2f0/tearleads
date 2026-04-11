import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { serializeDriverLicenseDocument } from "../../data/documents/documentKinds";
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
        linkedContainerIds: ["shared-container"],
      }),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "shared-container",
      documentKind: "note",
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

test("upsertDiscoveredNote preserves the active local container when another linked container rediscovers the document", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "local-note",
      containerId: "container-a",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 2,
    });

    await expect(
      sqlNotesPersistence.upsertDiscoveredNote(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        createdAt: "2026-04-06T01:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["container-a", "container-b"],
      }),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-a",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-06T01:00:00.000Z",
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-a",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });
  } finally {
    close();
  }
});

test("relinkPersistedNote updates the stored container and clears stale bundles on epoch change", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "local-note",
      containerId: "container-a",
      documentId: "remote-document",
      documentRecipientEnvelopes: '{"wrapped":true}',
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 2,
    });

    await expect(
      sqlNotesPersistence.relinkPersistedNote(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        documentId: "remote-document",
        noteId: "local-note",
      }),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-b",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: expect.any(String),
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-b",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });
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
        documentKind: "note",
        documentId: "document-c",
        title: "Note C",
        updatedAt: expect.any(String),
      },
      {
        id: "note-a",
        containerId: "container-a",
        documentKind: "note",
        documentId: "document-a",
        title: "Note A",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listNotesByContainerIdsOrDocumentIds returns directly and indirectly linked notes", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "direct-note",
      containerId: "shared-container",
      documentId: "direct-document",
      documentRecipientEnvelopes: null,
      text: "Direct Note",
      loroSnapshot: "snapshot-direct",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "linked-note",
      containerId: "outside-container",
      documentId: "linked-document",
      documentRecipientEnvelopes: null,
      text: "Linked Note",
      loroSnapshot: "snapshot-linked",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "unrelated-note",
      containerId: "outside-container",
      documentId: "unrelated-document",
      documentRecipientEnvelopes: null,
      text: "Unrelated Note",
      loroSnapshot: "snapshot-unrelated",
      accessEpoch: 1,
    });

    await expect(
      sqlNotesPersistence.listNotesByContainerIdsOrDocumentIds(execSql, {
        containerIds: ["shared-container"],
        documentIds: ["linked-document"],
      }),
    ).resolves.toEqual([
      {
        id: "linked-note",
        containerId: "outside-container",
        documentKind: "note",
        documentId: "linked-document",
        title: "Linked Note",
        updatedAt: expect.any(String),
      },
      {
        id: "direct-note",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "direct-document",
        title: "Direct Note",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listNotes derives driver license titles and document kinds from structured text", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "drivers-license",
      containerId: "identity-container",
      documentId: "document-license",
      documentRecipientEnvelopes: null,
      text: serializeDriverLicenseDocument({
        expirationDate: "2030-05-01",
        licenseId: "D1234567",
      }),
      loroSnapshot: "snapshot-license",
      accessEpoch: 1,
    });

    await expect(sqlNotesPersistence.listNotes(execSql)).resolves.toEqual([
      {
        id: "drivers-license",
        containerId: "identity-container",
        documentKind: "drivers_license",
        documentId: "document-license",
        title: "Driver's License D1234567",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});
