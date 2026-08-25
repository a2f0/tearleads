import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";

async function openTestConnection(input: {
  dbName: string;
  key: string;
}): Promise<{
  close: () => void;
  runtime: ClientSQLitePersistenceRuntime;
}> {
  const db = await initTestSqliteDatabase({
    ...input,
    cipher: "chacha20",
  });
  return {
    close: () => db.close(),
    runtime: createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }),
  };
}

function attachmentRows(storageKey: string) {
  return {
    localAttachments: [
      {
        blobId: null,
        byteLength: 4,
        detachedAt: null,
        localId: "local-document",
        mimeType: "text/plain",
        slotId: "slot-1",
        storageKey,
      },
    ],
    pendingAttachments: [
      {
        byteLength: 4,
        localId: "local-document",
        mimeType: "text/plain",
        name: `${storageKey}.txt`,
        slotId: "slot-1",
        storageKey,
      },
    ],
  };
}

test("a relink between byte staging and the attachment mutation leaves no old-identity rows", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "attachment-race" });
  await sqlDocumentsPersistence.ensureSchema(first.runtime.execSql);
  await sqlDocumentsPersistence.saveDocument(first.runtime.execSql, {
    accessEpoch: 1,
    containerId: "old-container",
    documentId: "old-document",
    id: "local-document",
    snapshotEndVersion: "",
    text: "",
  });
  const second = await openTestConnection({ dbName, key: "attachment-race" });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const staleRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      "local-document",
    );
    if (!staleRecord) throw new Error("Expected the stale document record");
    await sqlDocumentsPersistence.relinkPersistedDocument(
      second.runtime.execSql,
      {
        accessEpoch: 2,
        containerId: "replacement-container",
        documentId: "replacement-document",
        localId: "local-document",
      },
    );

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        first.runtime.execSql,
        {
          acceptedPendingUpdateIds: [],
          attachmentStaging: attachmentRows("stale-storage"),
          document: {
            ...staleRecord,
            snapshotEndVersion: "stale-attachment-version",
          },
          expectedRecord: staleRecord,
          pendingUpdate: {
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            sourceVersionVector: null,
            updateData: "dXBkYXRl",
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).resolves.toMatchObject({ committed: false });
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(
        first.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        first.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        first.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        first.runtime.execSql,
        "local-document",
      ),
    ).toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(
        first.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject({ documentId: "replacement-document" });
  } finally {
    first.close();
    second.close();
  }
});

test("a queue insertion failure rolls back every staged attachment row", async () => {
  const connection = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "attachment-rollback",
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(connection.runtime.execSql);
    await sqlDocumentsPersistence.saveDocument(connection.runtime.execSql, {
      accessEpoch: 1,
      containerId: "container",
      documentId: "document",
      id: "local-document",
      snapshotEndVersion: "",
      text: "",
    });
    await connection.runtime.execSql(`
      CREATE TRIGGER reject_attachment_history
      BEFORE INSERT ON document_history_updates
      BEGIN
        SELECT RAISE(ABORT, 'forced attachment history failure');
      END
    `);
    const currentRecord = await sqlDocumentsPersistence.loadDocument(
      connection.runtime.execSql,
      "local-document",
    );
    if (!currentRecord) throw new Error("Expected the current document record");

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        connection.runtime.execSql,
        {
          acceptedPendingUpdateIds: [],
          attachmentStaging: attachmentRows("rolled-back-storage"),
          document: {
            ...currentRecord,
            snapshotEndVersion: "rolled-back-version",
          },
          expectedRecord: currentRecord,
          pendingUpdate: {
            partialEndVersionVector: "end",
            partialStartVersionVector: "start",
            sourceVersionVector: null,
            updateData: "dXBkYXRl",
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).rejects.toThrow();
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject({ snapshotEndVersion: "" });
  } finally {
    connection.close();
  }
});

test("successful slot replacement queues the displaced blob key", async () => {
  const connection = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "attachment-replacement-reclaim",
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(connection.runtime.execSql);
    await sqlDocumentsPersistence.saveDocument(connection.runtime.execSql, {
      accessEpoch: 1,
      containerId: "container",
      documentId: "document",
      id: "local-document",
      snapshotEndVersion: "",
      text: "",
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      connection.runtime.execSql,
      "local-document",
    );
    if (!originalRecord) throw new Error("Expected the original document");
    await sqlDocumentsPersistence.commitDocumentMutation(
      connection.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        attachmentStaging: attachmentRows("displaced-storage"),
        document: { ...originalRecord, snapshotEndVersion: "attached" },
        expectedRecord: originalRecord,
        settleAcceptedPendingOnConflict: false,
      },
      async () => undefined,
    );
    const attachedRecord = await sqlDocumentsPersistence.loadDocument(
      connection.runtime.execSql,
      "local-document",
    );
    if (!attachedRecord) throw new Error("Expected the attached document");

    await sqlDocumentsPersistence.commitDocumentMutation(
      connection.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        attachmentStaging: attachmentRows("replacement-storage"),
        document: { ...attachedRecord, snapshotEndVersion: "replaced" },
        expectedRecord: attachedRecord,
        settleAcceptedPendingOnConflict: false,
      },
      async () => undefined,
    );

    expect(
      await connection.runtime.execSql(
        "SELECT storage_key FROM document_orphan_blob_reclaims ORDER BY storage_key",
      ),
    ).toEqual([{ storage_key: "displaced-storage" }]);
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject([{ storageKey: "replacement-storage" }]);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject([{ storageKey: "replacement-storage" }]);
  } finally {
    connection.close();
  }
});

test("a stale removal cannot change attachment rows after a relink", async () => {
  const connection = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "attachment-removal-cas",
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(connection.runtime.execSql);
    await sqlDocumentsPersistence.saveDocument(connection.runtime.execSql, {
      accessEpoch: 1,
      containerId: "old-container",
      documentId: "old-document",
      id: "local-document",
      snapshotEndVersion: "",
      text: "",
    });
    const originalRecord = await sqlDocumentsPersistence.loadDocument(
      connection.runtime.execSql,
      "local-document",
    );
    if (!originalRecord) throw new Error("Expected the original document");
    await sqlDocumentsPersistence.commitDocumentMutation(
      connection.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        attachmentStaging: attachmentRows("retained-storage"),
        document: { ...originalRecord, snapshotEndVersion: "attached" },
        expectedRecord: originalRecord,
        settleAcceptedPendingOnConflict: false,
      },
      async () => undefined,
    );
    const attachedRecord = await sqlDocumentsPersistence.loadDocument(
      connection.runtime.execSql,
      "local-document",
    );
    if (!attachedRecord) throw new Error("Expected the attached document");

    await sqlDocumentsPersistence.relinkPersistedDocument(
      connection.runtime.execSql,
      {
        accessEpoch: 2,
        containerId: "replacement-container",
        documentId: "replacement-document",
        localId: "local-document",
      },
    );
    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        connection.runtime.execSql,
        {
          acceptedPendingUpdateIds: [],
          attachmentRemoval: {
            mode: "delete",
            slotId: "slot-1",
            storageKey: "retained-storage",
          },
          document: { ...attachedRecord, snapshotEndVersion: "removed" },
          expectedRecord: attachedRecord,
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).resolves.toMatchObject({ committed: false });
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject([{ storageKey: "retained-storage" }]);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(
        connection.runtime.execSql,
        "local-document",
      ),
    ).toMatchObject([{ detachedAt: null, storageKey: "retained-storage" }]);
  } finally {
    connection.close();
  }
});
