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
import { invalidateDocumentStorePullContinuation } from "./pullContinuationInvalidation";
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

test("a store durably invalidates a regressed cursor before a failed fresh retry", async () => {
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
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "tracked-snapshot-page-2",
  };
  await defaultDocumentsPersistence.saveDocument(database.execSql, {
    ...record,
    pullContinuation: rejectedContinuation,
  });
  const state = createDocumentStoreState(
    record.id,
    runtime,
    defaultDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    record.documentId,
  );
  state.doc = document;
  state.initialized = true;
  state.pullContinuation = rejectedContinuation;
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
    expect(attempt).toBeNull();
    const restarted = await defaultDocumentsPersistence.loadDocument(
      database.execSql,
      record.id,
    );
    expect(restarted?.pullContinuation).toBeUndefined();
    expect(restarted?.pullContinuationRecoveryRequired).toBe(true);
    expect(state.record?.pullContinuationRecoveryRequired).toBe(true);
  } finally {
    database.close();
  }
});

test("cursor invalidation reloads progress advanced by another pane", async () => {
  const database = await createTestExecSql("pull-invalidation-reload");
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  const document = await createDocument("pull-invalidation-reload");
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const advancedContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "page-3",
  };
  const requestRecord: DocumentRecord = {
    accessEpoch: 1,
    accessStateHash: "access-1",
    containerId: "container-1",
    contentKeyBundle: "content-key-1",
    documentId: "document-1",
    documentKekTargets: "targets-1",
    documentManifestBundle: "manifest-1",
    id: "local-1",
    lastCommitLsn: "0/2",
    pendingBaseVersion: encodeVersionVector(document),
    pullContinuation: rejectedContinuation,
    snapshotEndVersion: encodeVersionVector(document),
    text: "",
  };
  await defaultDocumentsPersistence.saveDocument(database.execSql, {
    ...requestRecord,
    lastCommitLsn: "0/3",
    pullContinuation: advancedContinuation,
  });
  const advancedDocument = await createDocument(
    "pull-invalidation-advanced-pane",
  );
  advancedDocument.getText("text").update("content from advanced page");
  await defaultDocumentsPersistence.appendHistoryUpdates(database.execSql, {
    localId: requestRecord.id,
    origin: "remote",
    updates: [bytesToBase64(exportAllUpdates(advancedDocument))],
  });
  const runtime = {
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    infra: {
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: database.execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { containerId: "container-1", domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    requestRecord.id,
    runtime,
    defaultDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    requestRecord.documentId,
  );
  state.doc = document;
  state.initialized = true;
  state.pendingBaseVersion = requestRecord.pendingBaseVersion ?? null;
  state.pullContinuation = rejectedContinuation;
  state.record = requestRecord;
  const generation = captureDocumentStoreSyncGeneration(state, document);
  if (!generation) throw new Error("Expected a live sync generation");

  try {
    await invalidateDocumentStorePullContinuation({
      continuation: rejectedContinuation,
      currentRecord: requestRecord,
      generation,
      state,
    });

    expect(state.pullContinuation).toEqual(advancedContinuation);
    expect(state.record).toMatchObject({
      lastCommitLsn: "0/3",
      pullContinuation: advancedContinuation,
    });
    expect(getTextValue(document)).toBe("content from advanced page");
  } finally {
    database.close();
  }
});

test("cursor invalidation uses a non-SQL persistence adapter", async () => {
  const document = await createDocument("custom-pull-invalidation");
  const rejectedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "custom-page-2",
  };
  const requestRecord: DocumentRecord = {
    accessEpoch: 3,
    accessStateHash: "access-3",
    containerId: "container-3",
    contentKeyBundle: "content-key-3",
    documentId: "document-3",
    documentKekTargets: "targets-3",
    documentManifestBundle: "manifest-3",
    id: "local-3",
    lastCommitLsn: "0/2",
    pendingBaseVersion: encodeVersionVector(document),
    pullContinuation: rejectedContinuation,
    snapshotEndVersion: encodeVersionVector(document),
    text: "",
  };
  let directSqlCallCount = 0;
  const execSql = (async () => {
    directSqlCallCount += 1;
    throw new Error("Custom persistence must not execute SDK-owned SQL");
  }) as ExecSql;
  const invalidationInputs: unknown[] = [];
  const persistence = {
    async invalidatePullContinuation(_execSql: ExecSql, input: unknown) {
      invalidationInputs.push(input);
      const { pullContinuation: _rejected, ...current } = requestRecord;
      return {
        historyRestoreState: null,
        record: {
          ...current,
          pullContinuationRecoveryRequired: true as const,
        },
      };
    },
    async loadHistoryRestoreState() {
      return null;
    },
  } as unknown as DocumentsPersistence;
  const runtime = {
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    infra: {
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { containerId: "container-3", domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    requestRecord.id,
    runtime,
    persistence,
    noopDocumentStorePersistenceEffects,
    requestRecord.documentId,
  );
  state.doc = document;
  state.initialized = true;
  state.pendingBaseVersion = requestRecord.pendingBaseVersion ?? null;
  state.pullContinuation = rejectedContinuation;
  state.record = requestRecord;
  const generation = captureDocumentStoreSyncGeneration(state, document);
  if (!generation) throw new Error("Expected a live sync generation");

  await invalidateDocumentStorePullContinuation({
    continuation: rejectedContinuation,
    currentRecord: requestRecord,
    generation,
    state,
  });

  expect(directSqlCallCount).toBe(0);
  expect(invalidationInputs).toEqual([
    {
      accessEpoch: 3,
      accessStateHash: "access-3",
      continuation: rejectedContinuation,
      contentKeyBundle: "content-key-3",
      documentId: "document-3",
      documentKekTargets: "targets-3",
      documentManifestBundle: "manifest-3",
      lastCommitLsn: "0/2",
      localId: "local-3",
    },
  ]);
  expect(state.pullContinuation).toBeNull();
  expect(state.record?.pullContinuationRecoveryRequired).toBe(true);
});
