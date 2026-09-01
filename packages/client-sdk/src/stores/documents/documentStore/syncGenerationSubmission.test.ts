import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { DocumentRecord } from "../../../workflows/documents";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";
import { ensureRemoteDocument } from "./syncShared";

type SyncFixture = Awaited<ReturnType<typeof createMaterializedSyncFixture>>;

function createRuntime(
  apiClient: ReturnType<typeof createMockApiClient>,
  execSql: Parameters<typeof defaultDocumentsPersistence.ensureSchema>[0],
  fixture: SyncFixture,
) {
  return createDocumentsWorkflowRuntime({
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
      execSql,
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
}

test("a replaced store generation cannot submit a planned remote sync", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "document-store-stale-sync-submit",
  );

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const currentDoc = await createDocument("stale-sync-current");
    const replacementDoc = await createDocument("stale-sync-replacement");
    let state: ReturnType<typeof createDocumentStoreState>;
    let projectionReads = 0;
    let submissions = 0;
    const apiClient = createMockApiClient({
      getDocumentWriterProjectionResult: async () => {
        projectionReads += 1;
        state.doc = replacementDoc;
        return { data: fixture.writerProjection, ok: true };
      },
      syncDocumentResult: async () => {
        submissions += 1;
        throw new Error("A superseded sync must not submit");
      },
    });
    const record: DocumentRecord = {
      accessEpoch: 1,
      containerId: fixture.projection.containerId,
      documentId: fixture.writerProjection.documentId,
      id: "document-store-stale-sync-local",
      snapshotEndVersion: encodeVersionVector(currentDoc),
      text: "",
    };
    state = createDocumentStoreState(
      record.id,
      createRuntime(apiClient, execSql, fixture),
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      record.documentId,
    );
    state.doc = currentDoc;
    state.initialized = true;
    state.record = record;
    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected a live sync generation");

    const attempt = await requestRemoteDocumentSync({
      currentDoc,
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

    expect(attempt).toBeNull();
    expect(projectionReads).toBe(1);
    expect(submissions).toBe(0);
    expect(state.doc).toBe(replacementDoc);
  } finally {
    close();
  }
});

test("a replaced store generation cannot submit a planned remote create", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "document-store-stale-create-submit",
  );

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const currentDoc = await createDocument("stale-create-current");
    const replacementDoc = await createDocument("stale-create-replacement");
    let state: ReturnType<typeof createDocumentStoreState>;
    let projectionReads = 0;
    let submissions = 0;
    const apiClient = createMockApiClient({
      createDocumentResult: async () => {
        submissions += 1;
        throw new Error("A superseded create must not submit");
      },
      getContainerWriterProjectionResult: async () => {
        projectionReads += 1;
        state.doc = replacementDoc;
        return { data: fixture.projection, ok: true };
      },
    });
    const record: DocumentRecord = {
      accessEpoch: 0,
      containerId: fixture.projection.containerId,
      documentId: null,
      id: "document-store-stale-create-local",
      snapshotEndVersion: encodeVersionVector(currentDoc),
      text: "",
    };
    state = createDocumentStoreState(
      record.id,
      createRuntime(apiClient, execSql, fixture),
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      record.documentId,
    );
    state.doc = currentDoc;
    state.initialized = true;
    state.record = record;
    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected a live sync generation");

    const created = await ensureRemoteDocument(
      state,
      currentDoc,
      record,
      { publicKey: fixture.publicKey, secretKey: fixture.secretKey },
      generation,
    );

    expect(created).toBe(record);
    expect(projectionReads).toBe(1);
    expect(submissions).toBe(0);
    expect(state.doc).toBe(replacementDoc);
  } finally {
    close();
  }
});
