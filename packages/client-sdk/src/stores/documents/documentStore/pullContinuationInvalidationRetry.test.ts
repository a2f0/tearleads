import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  getTextValue,
} from "@symcrypt/loro";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  createMaterializedSyncFixture,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { DocumentRecord } from "../../../workflows/documents";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState, setReadySnapshot } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";

test("an advanced durable winner republishes before a failed fresh retry", async () => {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("pull-invalidation-winner-retry");
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  const requests: DocumentSyncRequest[] = [];
  let installAdvancedWinner: () => Promise<void> = async () => {
    throw new Error("Advanced winner was not initialized");
  };
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => fixture.writerProjection,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
    syncDocumentResult: async (documentId, request) => {
      requests.push(request);
      if (requests.length > 1) {
        return {
          kind: "network",
          message: "fresh retry offline",
          method: "POST",
          ok: false,
          path: `/documents/${documentId}/sync`,
          report: () => undefined,
          status: null,
          statusText: "",
        };
      }
      await installAdvancedWinner();
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
  const runtime = createDocumentsWorkflowRuntime({
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: fixture.author.organizationId,
      userId: fixture.author.signerUserId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: database.execSql,
    },
    resolveTrustedUserIdentity: fixture.resolveProjectionUserKey,
    state: {
      containerId: fixture.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
  const document = await createDocument("pull-invalidation-winner-retry");
  const baseVersion = encodeVersionVector(document);
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "tracked-snapshot-page-2",
  };
  const advancedContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "advanced-page-3",
  };
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
    effectiveAccessLevel: "write",
    id: "pull-invalidation-winner-retry-local",
    lastCommitLsn: "0/1",
    pendingBaseVersion: baseVersion,
    pullContinuation: rejectedContinuation,
    snapshotEndVersion: baseVersion,
    text: "",
  };
  await defaultDocumentsPersistence.saveDocument(database.execSql, record);
  const advancedDocument = await createDocument(
    "pull-invalidation-winner-retry-advanced",
  );
  advancedDocument.getText("text").update("content from advanced pane");
  const advancedVersion = encodeVersionVector(advancedDocument);
  installAdvancedWinner = async () => {
    await defaultDocumentsPersistence.appendHistoryUpdates(database.execSql, {
      localId: record.id,
      origin: "remote",
      updates: [bytesToBase64(exportAllUpdates(advancedDocument))],
    });
    await defaultDocumentsPersistence.saveDocument(database.execSql, {
      ...record,
      effectiveAccessLevel: "read",
      lastCommitLsn: "0/3",
      pendingBaseVersion: advancedVersion,
      pullContinuation: advancedContinuation,
      snapshotEndVersion: advancedVersion,
      text: "content from advanced pane",
    });
  };
  const state = createDocumentStoreState(
    record.id,
    runtime,
    defaultDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    record.documentId,
  );
  state.doc = document;
  state.initialized = true;
  state.pendingBaseVersion = baseVersion;
  state.pullContinuation = rejectedContinuation;
  state.record = record;
  state.writerProjection = fixture.writerProjection;
  setReadySnapshot(state, document, true, "optimistic local draft");
  state.pendingLocalWrites = 1;
  let notificationCount = 0;
  state.listeners.add(() => {
    notificationCount += 1;
  });
  const generation = captureDocumentStoreSyncGeneration(state, document);
  if (!generation) throw new Error("Expected a live sync generation");

  try {
    const attempt = await requestRemoteDocumentSync({
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

    expect(requests.map(({ pullCursor }) => pullCursor)).toEqual([
      rejectedContinuation.cursor,
      undefined,
    ]);
    expect(attempt).toBeNull();
    expect(state.pullContinuation).toEqual(advancedContinuation);
    expect(state.record).toMatchObject({
      effectiveAccessLevel: "read",
      lastCommitLsn: "0/3",
      pullContinuation: advancedContinuation,
    });
    expect(getTextValue(document)).toBe("content from advanced pane");
    expect(state.snapshot).toMatchObject({
      canWrite: false,
      effectiveAccessLevel: "read",
      ready: true,
      syncing: true,
      text: "optimistic local draft",
    });
    expect(notificationCount).toBe(1);
  } finally {
    database.close();
  }
});
