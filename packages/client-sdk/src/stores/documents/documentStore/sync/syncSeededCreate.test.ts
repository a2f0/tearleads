import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/documentFixtures";
import { createResponseFromRequest } from "../../../../../test/helpers/documentResponseFixtures";
import { createProbeRuntime } from "../../../../../test/helpers/remoteSyncWait";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  type DocumentRecord,
  defaultDocumentsPersistence,
} from "../../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { ensureSeededRemoteDocument } from "./syncSeededCreate";

type CreateResult = Awaited<ReturnType<ApiClient["createDocumentResult"]>>;

const manifestExists: CreateResult = {
  code: "document_manifest_already_exists",
  kind: "http",
  message: "POST /documents: 409 Conflict: manifest already exists",
  method: "POST",
  ok: false,
  path: "/documents",
  report: () => undefined,
  status: 409,
  statusText: "Conflict",
};

const paymentRequired: CreateResult = {
  kind: "http",
  message: "POST /documents: 402 Payment Required",
  method: "POST",
  ok: false,
  path: "/documents",
  report: () => undefined,
  status: 402,
  statusText: "Payment Required",
};

async function acknowledge(
  request: DocumentCreateRequest,
): Promise<CreateResult> {
  const seedId = request.initialSync?.outgoingUpdates[0]?.id;
  return {
    data: {
      ...(await createResponseFromRequest(request)),
      ...(seedId
        ? {
            initialSync: {
              acceptedOutgoingUpdateIds: [seedId],
              commitLsn: "0/10",
              commitLsnMode: "tracked" as const,
            },
          }
        : {}),
    },
    ok: true as const,
  };
}

/** One never-created document whose whole content is one queued row. */
async function runSeededCreate(
  name: string,
  respond: (
    request: DocumentCreateRequest,
    attempt: number,
  ) => Promise<CreateResult>,
) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(name);
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    const document = await createDocument(`${name}-peer`);
    document.getText("text").update("hello");
    document.commit();
    const record: DocumentRecord = {
      id: `${name}-local`,
      accessEpoch: 1,
      containerId: fixture.projection.containerId,
      documentId: null,
      snapshotEndVersion: encodeVersionVector(document),
      text: "hello",
    };
    await defaultDocumentsPersistence.saveDocument(execSql, record);
    const fields = createPendingUpdateFields(exportAllUpdates(document));
    if (!fields) throw new Error("Expected a non-empty initial update");
    await defaultDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: record.id,
      ...fields,
    });
    const queued = await defaultDocumentsPersistence.listPendingUpdates(
      execSql,
      record.id,
    );
    const requests: DocumentCreateRequest[] = [];
    const runtime = {
      ...createProbeRuntime({
        execSql,
        fixture,
        syncDocument: async () => null,
      }),
      apiClient: createMockApiClient({
        createDocument: async () => null,
        createDocumentResult: async (request) => {
          requests.push(request);
          return respond(request, requests.length);
        },
        getContainerWriterProjection: async () => fixture.projection,
        getDocumentWriterProjection: async () => null,
        primeDocumentWriterProjection: () => undefined,
      }),
    };
    const state = createDocumentStoreState(
      record.id,
      runtime,
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    state.doc = document;
    state.record = record;
    state.initialized = true;
    state.pendingBaseVersion = emptyVersionVector();
    // A signal raised before the pass, as a freshly opened store raises one.
    state.remoteUpdatePending = true;
    state.remoteUpdateSignalSeq = 1;
    const generation = captureDocumentStoreSyncGeneration(state, document);
    if (!generation) throw new Error("Expected sync generation");

    const created = await ensureSeededRemoteDocument({
      consumedRemoteUpdateSignalSeq: 1,
      currentDoc: document,
      encapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      generation,
      nextRecord: record,
      pendingUpdates: queued,
      state,
    });
    return {
      created,
      documentVersion: encodeVersionVector(document),
      queued,
      remaining: await defaultDocumentsPersistence.listPendingUpdates(
        execSql,
        record.id,
      ),
      requests,
      state,
    };
  } finally {
    close();
  }
}

test("an acknowledged create settles its seed and answers the earlier signal", async () => {
  const result = await runSeededCreate(
    "seeded-create-acknowledged",
    (request) => acknowledge(request),
  );
  expect(result.requests).toHaveLength(1);
  expect(
    result.requests[0]?.initialSync?.outgoingUpdates.map((update) => update.id),
  ).toEqual(result.queued.map((row) => row.id));
  expect(result.remaining).toEqual([]);
  expect(result.created.pendingUpdates).toEqual([]);
  expect(result.created.record?.lastCommitLsn).toBe("0/10");
  expect(result.state.remoteUpdatePending).toBe(false);
  expect(
    satisfiesVersionVector(
      result.state.pendingBaseVersion,
      result.documentVersion,
    ),
  ).toBe(true);
});

test("a lost seeded create response leaves the seed queued for its sync", async () => {
  const result = await runSeededCreate("seeded-create-lost-response", () =>
    Promise.resolve(manifestExists),
  );
  // An existing manifest is adopted, never resubmitted without the seed.
  expect(result.requests).toHaveLength(1);
  expect(result.remaining.map((row) => row.id)).toEqual(
    result.queued.map((row) => row.id),
  );
  expect(result.created.record?.lastCommitLsn ?? null).toBeNull();
  expect(result.state.remoteUpdatePending).toBe(true);
});

test("a refused seeded create falls back to the plain create once", async () => {
  const result = await runSeededCreate(
    "seeded-create-refused",
    (request, attempt) =>
      attempt === 1 ? Promise.resolve(paymentRequired) : acknowledge(request),
  );
  expect(
    result.requests.map((request) => Boolean(request.initialSync)),
  ).toEqual([true, false]);
  expect(result.created.record?.documentId).toBeTruthy();
  expect(result.remaining.map((row) => row.id)).toEqual(
    result.queued.map((row) => row.id),
  );
  expect(result.created.record?.lastCommitLsn ?? null).toBeNull();
  expect(result.state.remoteUpdatePending).toBe(true);
});
