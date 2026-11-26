import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentFixtures";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import { waitFor } from "../../../../../test/helpers/data/waitFor";
import {
  readDurableDocumentState,
  verifyHistory,
} from "../../../../../test/helpers/stores/historyVerificationFixtures";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";

/**
 * A server that commits every outgoing update in order and serves raw
 * history as of the request, once `releaseRawPage` lets the response go.
 */
async function createHeldRawHistoryHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const sql = await createTestExecSql(name);
  const committed: DocumentSyncResponse["updates"] = [];
  const rawRequests: DocumentSyncRequest[] = [];
  let storedDocument: DocumentCreateFixture | null = null;
  let releaseRawPage: () => void = () => undefined;
  const rawPageHeld = new Promise<void>((resolve) => {
    releaseRawPage = resolve;
  });
  const apiClient = createMockApiClient({
    async createDocument(
      request: Parameters<typeof createResponseFromRequest>[0],
    ) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    listDocumentAttachments: async () => [],
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      const response = createEchoDocumentSyncResponse({
        commitLsn: `0/${committed.length + 1}0`,
        request,
        storedDocument,
      });
      if (request.historyMode !== "raw") {
        committed.push(...response.updates);
        return response;
      }
      // The server freezes a raw pull at the request's commit.
      const frozen = [...committed];
      rawRequests.push(request);
      await rawPageHeld;
      return { ...response, commitLsn: "0/FF0", updates: frozen };
    },
  });
  const runtime = createOnlineDocumentsRuntime({
    apiClient,
    execSql: sql.execSql,
    fixture,
  });
  return { ...sql, committed, rawRequests, releaseRawPage, runtime };
}

// Verification reads beside the live document: it holds no sync lane, write
// chain, or lock the store waits on, so an edit and its upload go through
// while the verifier waits on the server.
test("a store edits and syncs while a raw history page is held open", async () => {
  const harness = await createHeldRawHistoryHarness("history-verify-live");
  const removeWebLocks = installFakeWebLocks();
  const localId = "history-verify-live-note";
  const store = createDocumentStore(
    localId,
    harness.runtime,
    defaultDocumentsPersistence,
    null,
    "Founding text",
  );
  try {
    expect(await store.ensureInitialized()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    await store.setText("An uploaded edit");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    const committedBefore = harness.committed.length;

    const verifying = verifyHistory(harness.runtime, localId);
    await waitFor(
      () => harness.rawRequests.length === 1,
      "Expected the verifier to ask for raw history",
    );
    await store.setText("Edited while verifying");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(harness.committed.length).toBeGreaterThan(committedBefore);
    expect(store.getSnapshot().text).toBe("Edited while verifying");
    const whileHeld = await readDurableDocumentState(harness.execSql, localId);
    expect(whileHeld.windows).toEqual([]);

    harness.releaseRawPage();
    const result = await verifying;

    // It compared the history durable when it began with the history the
    // server had frozen then.
    expect(result).toMatchObject({
      serverAhead: false,
      status: "verified",
      voidUpdateCount: 0,
    });
    expect(harness.rawRequests).toHaveLength(1);
    expect(harness.rawRequests[0]).toMatchObject({
      historyMode: "raw",
      localVersionVector: null,
      outgoingUpdates: [],
    });
    expect(store.getSnapshot().text).toBe("Edited while verifying");
    expect(await readDurableDocumentState(harness.execSql, localId)).toEqual(
      whileHeld,
    );
  } finally {
    harness.releaseRawPage();
    removeWebLocks();
    harness.close();
  }
}, 15_000);
