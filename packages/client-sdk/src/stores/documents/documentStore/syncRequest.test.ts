import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@symcrypt/loro";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  createMaterializedSyncFixture,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type {
  DocumentRecord,
  DocumentsPersistence,
} from "../../../workflows/documents";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { chainIdentityWrite } from "./identityWriteChain";
import { createDocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import {
  deleteUpstreamDeletedDocument,
  requestRemoteDocumentSync,
} from "./syncRequest";

test("a deletion response waits behind relink and cannot delete the new identity", async () => {
  const currentDoc = await createDocument("deletion-relink-document");
  const execSql = (async () => []) as ExecSql;
  const requestRecord = {
    accessEpoch: 1,
    containerId: "container-a",
    documentId: "document-a",
    id: "local-document",
  } as DocumentRecord;
  const deletedLocalIds: string[] = [];
  const persistence = {
    deleteDocument: async (_execSql: ExecSql, localId: string) => {
      deletedLocalIds.push(localId);
    },
  } as unknown as DocumentsPersistence;
  const runtime = {
    infra: {
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    requestRecord.id,
    runtime,
    persistence,
    noopDocumentStorePersistenceEffects,
    requestRecord.documentId,
  );
  state.doc = currentDoc;
  state.initialized = true;
  state.record = requestRecord;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) throw new Error("Expected a live sync generation");

  let releaseRelink: () => void = () => undefined;
  const relinkBlocked = new Promise<void>((resolve) => {
    releaseRelink = resolve;
  });
  let signalRelinkStarted: () => void = () => undefined;
  const relinkStarted = new Promise<void>((resolve) => {
    signalRelinkStarted = resolve;
  });
  const relink = chainIdentityWrite(state, async () => {
    signalRelinkStarted();
    await relinkBlocked;
    state.record = {
      ...requestRecord,
      containerId: "container-b",
      documentId: "document-b",
    };
  });
  await relinkStarted;

  const deletion = deleteUpstreamDeletedDocument(
    state,
    generation,
    requestRecord,
    requestRecord.documentId ?? "",
  );
  releaseRelink();
  await Promise.all([relink, deletion]);

  expect(deletedLocalIds).toEqual([]);
  expect(state.doc).toBe(currentDoc);
  expect(state.record?.documentId).toBe("document-b");
  expect(state.initialized).toBe(true);
});

test("a store pull invalidates a changed LSN mode and converges from a fresh snapshot", async () => {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("pull-mode-restart");
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  const requests: DocumentSyncRequest[] = [];
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => fixture.writerProjection,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
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
          { commitLsn: "0/0", commitLsnMode: "untracked" },
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
  const document = await createDocument("pull-mode-restart");
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
    id: "pull-mode-restart-local",
    lastCommitLsn: "0/1",
    snapshotEndVersion: encodeVersionVector(document),
    text: "",
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
  state.pullContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked",
    cursor: "tracked-snapshot-page-2",
  };
  state.record = record;
  state.writerProjection = fixture.writerProjection;
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
      "tracked-snapshot-page-2",
      undefined,
    ]);
    expect(requests.map(({ minLsn }) => minLsn)).toEqual(["0/2", "0/1"]);
    expect(state.pullContinuation).toBeNull();
    expect(attempt?.synced.hasIncompletePull).toBe(false);
    expect(attempt?.synced.response.commitLsnMode).toBe("untracked");
  } finally {
    database.close();
  }
});
