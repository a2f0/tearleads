import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { createSyncResponse } from "../../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import { createOnlineDocumentsRuntime } from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import {
  type DocumentRecord,
  defaultDocumentsPersistence,
} from "../../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

// A death in a window of several updates names none of them. Until the
// device has passed them, each pull asks for one update a page, so the next
// death names the update alone and counts toward it.
test("a store isolating updates a death left pulls one update a page", async () => {
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
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
  };

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
