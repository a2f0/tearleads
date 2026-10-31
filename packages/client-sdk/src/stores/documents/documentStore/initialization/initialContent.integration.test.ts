import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  DocumentCreateRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/documentFixtures";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/onlineDocumentStoreFixtures";
import { waitFor } from "../../../../../test/helpers/waitFor";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";

const ENV_ROWS = [
  { key: "API_URL", value: "https://example.test" },
  { key: "DEBUG", value: "false" },
];

test("a document opened with its fields and rows is created with them as its seed", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql("initial-content-online");
  const creates: DocumentCreateRequest[] = [];
  const syncs: DocumentSyncRequest[] = [];
  let storedDocument: DocumentCreateFixture | null = null;
  const apiClient = createMockApiClient({
    // Acknowledges a seed the way the API does once it commits it.
    async createDocumentResult(request: DocumentCreateRequest) {
      creates.push(request);
      storedDocument = await createResponseFromRequest(request);
      const seedId = request.initialSync?.outgoingUpdates[0]?.id;
      return {
        data: {
          ...storedDocument,
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
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      syncs.push(request);
      return createEchoDocumentSyncResponse({
        commitLsn: `0/${syncs.length + 1}0`,
        request,
        storedDocument,
      });
    },
  });
  const store = createDocumentStore(
    "online-env",
    createOnlineDocumentsRuntime({ apiClient, execSql, fixture }),
    defaultDocumentsPersistence,
    null,
    "",
    "env_file",
    {
      initialRows: ENV_ROWS,
      initialStructuredFields: { fileName: ".env" },
    },
  );

  try {
    expect(await store.ensureInitialized()).toBe(true);
    store.requestSync();
    await waitFor(
      () =>
        store.getSnapshot().documentId !== null && !store.getSnapshot().syncing,
      "The document was never created.",
      5_000,
    );

    // One create whose seed is the birth: kind, fields and rows in one
    // update, with no separate sync of a fields or row update after it.
    expect(creates).toHaveLength(1);
    expect(creates[0]?.initialSync?.outgoingUpdates).toHaveLength(1);
    expect(
      syncs.reduce((total, sync) => total + sync.outgoingUpdates.length, 0),
    ).toBe(0);
    expect(
      await defaultDocumentsPersistence.listPendingUpdates(
        execSql,
        "online-env",
      ),
    ).toEqual([]);
    expect(store.getSnapshot()).toMatchObject({
      documentKind: "env_file",
      structuredFields: { fileName: ".env" },
    });
    expect(store.getSnapshot().rows.map((row) => row.fields)).toEqual(ENV_ROWS);
  } finally {
    close();
  }
}, 10_000);
