import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { createDocument, exportAllUpdates } from "@symcrypt/loro";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import {
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import {
  type ContainerContentsPersistence,
  sqlContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import { createClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../data/sqlite/sqlSchema";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { renameContainerMetadataStateFromRuntime } from "./metadataPersistence";

async function openMetadataWriteRaceConnections() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "metadata-write-access-race",
  });
  const createRuntime = () =>
    createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    });
  const first = createRuntime();
  await sqlContainerContentsPersistence.ensureSchema(first.execSql);
  return { close: () => db.close(), first, second: createRuntime() };
}

test("a queued metadata retry cannot cross a durable write-access downgrade", async () => {
  const connections = await openMetadataWriteRaceConnections();
  let releasePrepareRead = () => {};
  const prepareReadBlocked = new Promise<void>((resolve) => {
    releasePrepareRead = resolve;
  });
  let signalPrepareRead = () => {};
  const prepareRead = new Promise<void>((resolve) => {
    signalPrepareRead = resolve;
  });
  try {
    const container = createContainerRecord({
      effectiveAccessLevel: "write",
      id: "container-1",
      metadataDocumentId: "metadata-document-1",
      name: "Durable name",
      parentId: null,
    });
    const document = await createDocument("metadata-write-access-race");
    writeContainerMetadataValue(document, {
      icon: null,
      name: container.name,
    });
    const record = createDocumentRecord({
      documentId: container.metadataDocumentId,
      id: container.id,
      metadataUpdates: bytesToBase64(exportAllUpdates(document)),
    });
    await sqlContainerContentsPersistence.saveContainer(
      connections.first.execSql,
      container,
      record,
    );
    let pauseFirstPrepareRead = true;
    const firstPanePersistence: ContainerContentsPersistence = {
      ...sqlContainerContentsPersistence,
      async loadContainerMetadataState(execSql, containerId) {
        const state =
          await sqlContainerContentsPersistence.loadContainerMetadataState(
            execSql,
            containerId,
          );
        if (pauseFirstPrepareRead) {
          pauseFirstPrepareRead = false;
          signalPrepareRead();
          await prepareReadBlocked;
        }
        return state;
      },
    };
    const metadataState = { container, doc: document, record };

    const queuedRename = renameContainerMetadataStateFromRuntime({
      metadataState,
      name: "Queued rename",
      persistence: firstPanePersistence,
      runtime: { infra: { execSql: connections.first.execSql } },
    });
    await prepareRead;
    await sqlContainerContentsPersistence.saveContainer(
      connections.second.execSql,
      { ...container, effectiveAccessLevel: "read" },
      record,
    );
    releasePrepareRead();

    const settled = await queuedRename;
    expect(settled).toMatchObject({
      container: { effectiveAccessLevel: "read", name: "Durable name" },
      pullContinuationSuperseded: true,
      syncIdentitySuperseded: true,
    });
    expect(readContainerMetadataValue(metadataState.doc, "/")).toEqual({
      icon: null,
      name: "Durable name",
    });
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        connections.second.execSql,
        container.id,
      ),
    ).toEqual([]);
  } finally {
    releasePrepareRead();
    connections.close();
  }
});
