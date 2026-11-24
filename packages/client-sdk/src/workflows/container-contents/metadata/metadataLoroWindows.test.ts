import { expect, test } from "bun:test";
import { encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { createSyncResponse } from "../../../../test/helpers/data/documentFixtures";
import { installFakeWebLocks } from "../../../../test/helpers/data/fakeWebLocks";
import {
  EMPTY_RESPONSE,
  FIRST,
  honest,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createOnlineDocumentsRuntime } from "../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { writeLoroWindowInTransaction } from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { createDocumentSyncLoroWindow } from "../../documents/sync/loroPassWindow";
import { buildMaterializedDocumentSyncPlan } from "../../documents/syncPlan/syncPlanMaterial";
import { createPrincipalPolicyOperation } from "../../principals/principalPolicyService";
import { createContainerMetadataDocument } from "./containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { metadataIncomingUpdateIsolation } from "./metadataIncomingUpdateIsolation";
import { syncRemoteContainerMetadata } from "./metadataRemoteSync";
import {
  containerMetadataScope,
  containerMetadataVerdictRecorder,
} from "./metadataSyncVerdicts";

const CONTAINER_ID = "metadata-loro-windows";

/** A metadata pull against a server that serves an empty page. */
async function createMetadataPull() {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql(
    `metadata-windows-${crypto.randomUUID()}`,
  );
  await ensureDocumentTables(database.execSql);
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
  const { documentId } = fixture.writerProjection;
  const container = createContainerRecord({
    id: CONTAINER_ID,
    metadataDocumentId: documentId,
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    contentKeyBundle: JSON.stringify(fixture.writerProjection.contentKeyBundle),
    documentId,
    documentKekTargets: JSON.stringify(
      fixture.writerProjection.documentKekTargets,
    ),
    documentManifestBundle: JSON.stringify(
      fixture.writerProjection.documentManifest,
    ),
    id: container.id,
    lastCommitLsn: "0/1",
  });
  const pull = () =>
    syncRemoteContainerMetadata({
      containerId: container.id,
      currentDocument: doc,
      documentId,
      isCurrent: () => true,
      localVersionVector: encodeVersionVector(doc),
      loroWindow: createDocumentSyncLoroWindow(),
      pendingUpdates: [],
      persistedState: record,
      policyOperation: createPrincipalPolicyOperation(),
      rekeyPendingUpdate: async () => null,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      runtime,
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });
  return { database, documentId, pull, requests };
}

// Container metadata pulls isolate as document pulls do: while a death left
// suspects on the metadata scope, each pull asks for one update a page.
test("a metadata pull isolating suspects asks for one update a page", async () => {
  const { database, documentId, pull, requests } = await createMetadataPull();
  try {
    await pull();
    await database.execSql(
      `INSERT INTO document_loro_isolation
         (app_kind, local_id, document_id, suspects)
       VALUES (?, ?, ?, '["suspect"]')`,
      [containerMetadataScope(CONTAINER_ID).appKind, CONTAINER_ID, documentId],
    );
    await pull();

    expect(requests.map(({ maxPageUpdates }) => maxPageUpdates)).toEqual([
      undefined,
      1,
    ]);
  } finally {
    database.close();
  }
});

// A dead lifetime's window on the metadata scope is claimed before the pull
// asks for its page, so the first pull after that death already isolates.
test("a metadata pull claims a dead lifetime's window first", async () => {
  const { database, documentId, pull, requests } = await createMetadataPull();
  const removeWebLocks = installFakeWebLocks();
  try {
    await writeLoroWindowInTransaction(
      getClientSQLitePersistenceRuntime(database.execSql).db,
      containerMetadataScope(CONTAINER_ID),
      {
        contentKeyEpoch: null,
        counts: false,
        documentId,
        judge: documentVerdictJudge(),
        keyFingerprint: null,
        lifetimeId: "dead",
        updateIds: ["first-suspect", "second-suspect"],
        windowId: "dead-window",
      },
      "2026-11-23T00:00:00.000Z",
    );

    await pull();

    expect(requests.map(({ maxPageUpdates }) => maxPageUpdates)).toEqual([1]);
    expect(
      await database.execSql("SELECT lifetime_id FROM document_loro_windows"),
    ).toEqual([]);
  } finally {
    removeWebLocks();
    database.close();
  }
});

// The metadata judge reads a served page inside the pass's window, so a
// death there is found by the next lifetime; the save that records the
// page's verdicts closes it in the same transaction.
test("a metadata page reads inside its window, which its save closes", async () => {
  const database = await createTestExecSql(
    `metadata-window-${crypto.randomUUID()}`,
  );
  await ensureDocumentTables(database.execSql);
  const removeWebLocks = installFakeWebLocks();
  const loroWindow = createDocumentSyncLoroWindow();
  const doc = await createContainerMetadataDocument(CONTAINER_ID);
  const documentId = "550e8400-e29b-41d4-a716-446655440d10";
  const windowRows = () =>
    database.execSql("SELECT update_ids FROM document_loro_windows");
  try {
    const { update } = await honest(FIRST);
    await metadataIncomingUpdateIsolation({
      currentDocument: doc,
      documentId,
      execSql: database.execSql,
      isCurrent: () => true,
      loroWindow,
      metadataScope: containerMetadataScope(CONTAINER_ID),
    }).validateIncomingUpdates({
      contentKeyFingerprintsByEpoch: new Map(),
      decryptedUpdates: [update],
      response: EMPTY_RESPONSE,
    });
    expect(await windowRows()).toEqual([
      { update_ids: JSON.stringify([FIRST]) },
    ]);

    const recorder = containerMetadataVerdictRecorder(
      CONTAINER_ID,
      {
        contentKeyFingerprintsByEpoch: new Map(),
        decryptedUpdates: [update],
        hasHeldPull: false,
        hasIncompletePull: false,
        plan: { documentId, request: {} },
        response: { pullPage: { hasMore: false }, updates: [] },
        voidedUpdates: [],
      } as unknown as SyncRemoteDocumentResult,
      loroWindow,
    );
    await recorder.commitSideEffect(database.execSql);
    await recorder.settleWindow(database.execSql);

    expect(await windowRows()).toEqual([]);
    expect(loroWindow.held).toBeNull();
  } finally {
    removeWebLocks();
    doc.free();
    database.close();
  }
});
