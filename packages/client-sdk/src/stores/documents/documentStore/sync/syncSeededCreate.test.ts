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
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/documentFixtures";
import { createResponseFromRequest } from "../../../../../test/helpers/documentResponseFixtures";
import { createProbeRuntime } from "../../../../../test/helpers/remoteSyncWait";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  type DocumentRecord,
  defaultDocumentsPersistence,
  documentWriterProjectionFromCreateResponse,
} from "../../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { handleDocumentRemoteEvents } from "./syncRemoteSignals";
import { ensureSeededRemoteDocument } from "./syncSeededCreate";
import { shouldSkipCleanScheduledDocumentSync } from "./syncShared";

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

interface SeededCreateServer {
  committed: DocumentWriterProjectionResponse | null;
  readonly fixture: Fixture;
  /**
   * Delivers an update hint for the document to the store mid-flight and
   * returns the store's signal sequence after it.
   */
  hint: (documentId: string, updateIds: string[]) => number;
}

type Fixture = Awaited<ReturnType<typeof createMaterializedSyncFixture>>;

function plannedDocumentId(request: DocumentCreateRequest): string {
  return String(Reflect.get(request.manifest, "objectId"));
}

/**
 * One never-created document whose whole content is one queued row. A
 * response may record the document it commits in `committed`, which the
 * writer-projection read then serves, as after an earlier attempt committed.
 */
async function runSeededCreate(
  name: string,
  respond: (
    request: DocumentCreateRequest,
    attempt: number,
    server: SeededCreateServer,
  ) => Promise<CreateResult>,
) {
  const fixture = await createMaterializedSyncFixture();
  let scheduled = 0;
  const server: SeededCreateServer = {
    committed: null,
    fixture,
    hint: () => 0,
  };
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
          return respond(request, requests.length, server);
        },
        getContainerWriterProjection: async () => fixture.projection,
        getDocumentWriterProjection: async (documentId) =>
          server.committed?.documentId === documentId ? server.committed : null,
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
    server.hint = (documentId, updateIds) => {
      (state.runtime.state.events as unknown[]).push({
        containerIds: [fixture.projection.containerId],
        documentId,
        type: "document_update_created",
        updateIds,
      });
      handleDocumentRemoteEvents(state, () => {
        scheduled += 1;
      });
      return state.remoteUpdateSignalSeq;
    };
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
      scheduled,
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

test("a peer edit hinted before the create response arrives still pulls", async () => {
  const observed: { seqAfterEcho?: number } = {};
  const result = await runSeededCreate(
    "seeded-create-delayed-response",
    async (request, _attempt, server) => {
      const documentId = plannedDocumentId(request);
      const seedId = request.initialSync?.outgoingUpdates[0]?.id ?? "";
      // The seed's own echo is self-authored and raises no signal.
      observed.seqAfterEcho = server.hint(documentId, [seedId]);
      // A peer edits the committed document before the response arrives,
      // while the store has no documentId yet.
      server.hint(documentId, ["peer-update"]);
      return acknowledge(request);
    },
  );
  expect(observed.seqAfterEcho).toBe(1);
  expect(result.remaining).toEqual([]);
  expect(result.created.record?.lastCommitLsn).toBe("0/10");
  // Only the signal raised before the create was submitted is answered.
  expect(result.state.remoteUpdatePending).toBe(true);
  expect(result.scheduled).toBe(1);
  const record = result.created.record;
  if (!record) throw new Error("Expected the created record");
  expect(
    shouldSkipCleanScheduledDocumentSync({
      currentRecord: record,
      pendingUpdates: result.created.pendingUpdates,
      state: result.state,
    }),
  ).toBe(false);
});

test("a lost seeded create response adopts the document and keeps its row queued", async () => {
  const result = await runSeededCreate(
    "seeded-create-lost-response",
    async (request, _attempt, server) => {
      // An earlier attempt committed this create; its response was lost.
      server.committed = documentWriterProjectionFromCreateResponse({
        containerProjection: server.fixture.projection,
        response: await createResponseFromRequest(request),
      });
      return manifestExists;
    },
  );
  // An existing manifest is adopted, never resubmitted without the seed.
  expect(result.requests).toHaveLength(1);
  expect(result.created.record?.documentId).toBe(
    String(Reflect.get(result.requests[0]?.manifest ?? {}, "objectId")),
  );
  // The adoption cannot tell whether the earlier attempt carried the seed, so
  // the row stays queued and the pass's ordinary sync sends it. That re-send
  // is re-encrypted, so a committed seed answers it with an update-id
  // conflict, which recovery settles or re-keys.
  expect(result.created.pendingUpdates.map((row) => row.id)).toEqual(
    result.queued.map((row) => row.id),
  );
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
