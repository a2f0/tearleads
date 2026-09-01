import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
} from "@tearleads/loro";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import {
  type DocumentsPersistence,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { createClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../data/sqlite/sqlSchema";
import { persistDocumentState } from "./persistence";

async function openDocumentWriteRaceConnections() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "document-write-access-race",
  });
  const createRuntime = () =>
    createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    });
  const first = createRuntime();
  await sqlDocumentsPersistence.ensureSchema(first.execSql);
  return { close: () => db.close(), first, second: createRuntime() };
}

test("a queued edit retry cannot cross a durable write-access downgrade", async () => {
  const connections = await openDocumentWriteRaceConnections();
  let releasePrepareRead = () => {};
  const prepareReadBlocked = new Promise<void>((resolve) => {
    releasePrepareRead = resolve;
  });
  let signalPrepareRead = () => {};
  const prepareRead = new Promise<void>((resolve) => {
    signalPrepareRead = resolve;
  });
  try {
    const document = await createDocument("document-write-access-race");
    document.getText("text").update("base");
    document.commit();
    const baseVersion = encodeVersionVector(document);
    const writableRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      effectiveAccessLevel: "write" as const,
      id: "local-1",
      pendingBaseVersion: baseVersion,
      snapshotEndVersion: baseVersion,
      text: "base",
    };
    await sqlDocumentsPersistence.saveDocument(
      connections.first.execSql,
      writableRecord,
    );
    document.getText("text").update("queued edit");
    const pendingUpdate = createPendingUpdateFields(
      exportUpdatesSince(document, baseVersion),
    );
    if (!pendingUpdate) throw new Error("Expected a queued document update");
    let pauseFirstPrepareRead = true;
    const firstPanePersistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocument(execSql, localId) {
        const record = await sqlDocumentsPersistence.loadDocument(
          execSql,
          localId,
        );
        if (pauseFirstPrepareRead) {
          pauseFirstPrepareRead = false;
          signalPrepareRead();
          await prepareReadBlocked;
        }
        return record;
      },
    };

    const queuedPersist = persistDocumentState({
      currentDoc: document,
      currentRecord: writableRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: connections.first.execSql,
      localId: writableRecord.id,
      patch: { snapshotEndVersion: encodeVersionVector(document) },
      pendingUpdate,
      persistence: firstPanePersistence,
    });
    await prepareRead;
    await sqlDocumentsPersistence.saveDocument(connections.second.execSql, {
      ...writableRecord,
      effectiveAccessLevel: "read",
    });
    releasePrepareRead();

    const settled = await queuedPersist;
    expect(settled).toMatchObject({
      pullContinuationSuperseded: true,
      record: { effectiveAccessLevel: "read", text: "base" },
      syncIdentitySuperseded: true,
    });
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        connections.second.execSql,
        writableRecord.id,
      ),
    ).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(
        connections.second.execSql,
        writableRecord.id,
      ),
    ).toMatchObject({ effectiveAccessLevel: "read", text: "base" });
  } finally {
    releasePrepareRead();
    connections.close();
  }
});
