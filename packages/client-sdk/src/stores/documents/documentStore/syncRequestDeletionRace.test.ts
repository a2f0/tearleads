import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import {
  createDocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { loadDocumentPurgeCheckpoint } from "../../../data/persistence/documentPurgeCheckpointPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../../data/sqlite/sqlSchema";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { deleteUpstreamDeletedDocument } from "./syncRequest";

async function openDeletionRaceConnection(input: {
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

test("an old-document deletion cannot erase another pane's relink", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openDeletionRaceConnection({
    dbName,
    key: "remote-delete-relink-race",
  });
  await sqlDocumentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openDeletionRaceConnection({
    dbName,
    key: "remote-delete-relink-race",
  });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const document = await createDocument("remote-delete-relink-race");
    document.getText("text").update("replacement must survive");
    const version = encodeVersionVector(document);
    const staleRecord = {
      accessEpoch: 1,
      containerId: "old-container",
      documentId: "old-document",
      effectiveAccessLevel: "write" as const,
      id: "local-document",
      snapshotEndVersion: version,
      text: "replacement must survive",
    };
    await sqlDocumentsPersistence.saveDocument(
      first.runtime.execSql,
      staleRecord,
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(
      first.runtime.execSql,
      {
        coveredTailIds: [],
        endVersionVector: version,
        force: true,
        localId: staleRecord.id,
        snapshot: bytesToBase64(exportFullHistorySnapshot(document)),
      },
    );
    const runtime = {
      infra: {
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql: first.runtime.execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: { domainScope: createDomainScope() },
      util: { log: () => undefined },
    } as unknown as DocumentsRuntime;
    const state = createDocumentStoreState(
      staleRecord.id,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      staleRecord.documentId,
    );
    state.doc = document;
    state.initialized = true;
    state.record = staleRecord;
    const generation = captureDocumentStoreSyncGeneration(state, document);
    if (!generation) throw new Error("Expected a live sync generation");

    await sqlDocumentsPersistence.relinkPersistedDocument(
      second.runtime.execSql,
      {
        accessEpoch: 2,
        containerId: "replacement-container",
        documentId: "replacement-document",
        localId: staleRecord.id,
      },
    );
    await deleteUpstreamDeletedDocument(
      state,
      generation,
      staleRecord,
      staleRecord.documentId,
    );

    expect(
      await sqlDocumentsPersistence.loadDocument(
        second.runtime.execSql,
        staleRecord.id,
      ),
    ).toMatchObject({
      accessEpoch: 2,
      containerId: "replacement-container",
      documentId: "replacement-document",
      text: "replacement must survive",
    });
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        second.runtime.execSql,
        staleRecord.id,
      ),
    ).not.toBeNull();
    expect(state.doc).toBe(document);
    expect(state.initialized).toBe(true);
  } finally {
    first.close();
    second.close();
  }
});

test("an interrupted verified purge rolls back its checkpoint and local deletion", async () => {
  const connection = await openDeletionRaceConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "remote-delete-proof-interruption",
  });
  const { execSql } = connection.runtime;
  const document = await createDocument("remote-delete-proof-interruption");
  const record = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "remote-document",
    effectiveAccessLevel: "write" as const,
    id: "local-document",
    snapshotEndVersion: encodeVersionVector(document),
    text: "must be removed atomically",
  };
  const checkpoint = {
    documentId: record.documentId,
    documentManifestHash: "document-manifest",
    organizationId: "organization",
    purgeEventHash: "purge-event",
  };
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, record);
    await loadDocumentPurgeCheckpoint(execSql, record.documentId);
    const runtime = {
      infra: {
        documentProjectors: createDocumentProjectorRegistry([]),
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: { domainScope: createDomainScope() },
      util: { log: () => undefined },
    } as unknown as DocumentsRuntime;
    const state = createDocumentStoreState(
      record.id,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      record.documentId,
    );
    state.doc = document;
    state.initialized = true;
    state.record = record;
    const generation = captureDocumentStoreSyncGeneration(state, document);
    if (!generation) throw new Error("Expected a live sync generation");

    let interrupt = true;
    const commitPurgeProof = async (transactionExecSql: typeof execSql) => {
      await advanceKeyingCheckpointsAtomically({
        access: [],
        documentPurgeCheckpoint: checkpoint,
        execSql: transactionExecSql,
        policies: [],
      });
      if (interrupt) throw new Error("simulated interruption");
    };

    await expect(
      deleteUpstreamDeletedDocument(
        state,
        generation,
        record,
        record.documentId,
        commitPurgeProof,
      ),
    ).rejects.toThrow("simulated interruption");
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, record.id),
    ).not.toBeNull();
    expect(
      await loadDocumentPurgeCheckpoint(execSql, record.documentId),
    ).toBeNull();
    expect(state.doc).toBe(document);

    interrupt = false;
    await deleteUpstreamDeletedDocument(
      state,
      generation,
      record,
      record.documentId,
      commitPurgeProof,
    );
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, record.id),
    ).toBeNull();
    expect(
      await loadDocumentPurgeCheckpoint(execSql, record.documentId),
    ).toEqual(checkpoint);
    expect(state.doc).toBeNull();
  } finally {
    connection.close();
  }
});
