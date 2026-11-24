import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { createSyncResponse } from "../../../../../test/helpers/data/documentFixtures";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import { createOnlineDocumentsRuntime } from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import { writeLoroWindowInTransaction } from "../../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import {
  createDocumentSyncLoroWindow,
  type DocumentRecord,
  defaultDocumentsPersistence,
} from "../../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

async function createPageLimitStore() {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("sync-page-limit");
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  const requests: DocumentSyncRequest[] = [];
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => fixture.writerProjection,
    syncDocumentResult: async (documentId, request) => {
      requests.push(request);
      const materialized = await buildMaterializedDocumentSyncPlan({
        author: fixture.author,
        execSql: database.execSql,
        localVersionVector: null,
        pendingUpdates: [],
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: fixture.writerProjection,
      });
      return {
        data: await createSyncResponse(
          { ...materialized.plan, documentId, request },
          { commitLsn: "0/1", commitLsnMode: "tracked" },
        ),
        ok: true,
      };
    },
  });
  const runtime = createOnlineDocumentsRuntime({
    apiClient,
    execSql: database.execSql,
    fixture,
  });
  const document = await createDocument("sync-page-limit");
  const record: DocumentRecord = {
    accessEpoch: 1,
    containerId: fixture.projection.containerId,
    contentKeyBundle: JSON.stringify(fixture.writerProjection.contentKeyBundle),
    documentId: fixture.writerProjection.documentId,
    documentKekTargets: JSON.stringify(
      fixture.writerProjection.documentKekTargets,
    ),
    documentManifestBundle: JSON.stringify(
      fixture.writerProjection.documentManifest,
    ),
    id: "sync-page-limit-local",
    lastCommitLsn: "0/1",
    snapshotEndVersion: encodeVersionVector(document),
    text: "",
  };
  await defaultDocumentsPersistence.saveDocument(database.execSql, record);
  const state = createDocumentStoreState(
    record.id,
    runtime,
    defaultDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    record.documentId,
  );
  state.doc = document;
  state.initialized = true;
  state.record = record;
  state.writerProjection = fixture.writerProjection;
  const pass = async () => {
    const generation = captureDocumentStoreSyncGeneration(state, document);
    if (!generation) throw new Error("Expected a live sync generation");
    await requestRemoteDocumentSync({
      policyOperation: createPrincipalPolicyOperation(),
      currentDoc: document,
      currentRecord: record,
      encapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      generation,
      pendingUpdates: [],
      loroWindow: createDocumentSyncLoroWindow(),
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
  };

  return { database, pass, record, requests };
}

// A death in a window of several updates names none of them. Until the
// device has passed them, each pull asks for one update a page, so the next
// death names the update alone and counts toward it.
test("a store isolating updates a death left pulls one update a page", async () => {
  const { database, pass, record, requests } = await createPageLimitStore();
  try {
    await pass();
    await database.execSql(
      `INSERT INTO document_loro_isolation
         (app_kind, local_id, document_id, suspects)
       VALUES ('documents', ?, ?, '["suspect"]')`,
      [record.id, record.documentId],
    );
    await pass();

    expect(requests.map(({ maxPageUpdates }) => maxPageUpdates)).toEqual([
      undefined,
      1,
    ]);
  } finally {
    database.close();
  }
});

// The windows a dead lifetime left are claimed before the pull asks for its
// page, so the first pull after a death that named no update isolates,
// rather than reading the whole page and dying on it again.
test("the first pull after such a death already asks for one update", async () => {
  const { database, pass, record, requests } = await createPageLimitStore();
  const { documentId } = record;
  if (!documentId) throw new Error("Expected a synced document");
  const removeWebLocks = installFakeWebLocks();
  try {
    await writeLoroWindowInTransaction(
      getClientSQLitePersistenceRuntime(database.execSql).db,
      { appKind: "documents", localId: record.id },
      {
        counts: false,
        documentId,
        judge: documentVerdictJudge(),
        lifetimeId: "dead",
        updateIds: ["first-suspect", "second-suspect"],
        windowId: "dead-window",
      },
      "2026-11-23T00:00:00.000Z",
    );

    await pass();

    expect(requests.map(({ maxPageUpdates }) => maxPageUpdates)).toEqual([1]);
  } finally {
    removeWebLocks();
    database.close();
  }
});
