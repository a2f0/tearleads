import { expect, spyOn, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentFixtures";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import type { SyncRemoteDocumentResult } from "../../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import { processLoroLifetimes } from "../../../../data/documents/shared/sync/loroLifetime";
import { writeLoroWindowInTransaction } from "../../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import {
  defaultDocumentsPersistence,
  RemoteDocumentService,
  readDocumentFoundingUpdate,
} from "../../../../workflows/documents";
import { createDocumentStore } from "../index";

/** A server that commits every outgoing update in order and serves raw history. */
async function createFoundingHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const sql = await createTestExecSql(name);
  const committed: DocumentSyncResponse["updates"] = [];
  const rawRequests: DocumentSyncRequest[] = [];
  let storedDocument: DocumentCreateFixture | null = null;
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
      rawRequests.push(request);
      return { ...response, commitLsn: "0/FF0", updates: [...committed] };
    },
  });
  const runtime = createOnlineDocumentsRuntime({
    apiClient,
    execSql: sql.execSql,
    fixture,
  });
  return { ...sql, committed, fixture, rawRequests, runtime };
}

test("a founding update replays only the first committed update and names its signer", async () => {
  const harness = await createFoundingHarness("founding-update-first");
  const store = createDocumentStore(
    "founding-note",
    harness.runtime,
    defaultDocumentsPersistence,
    null,
    "Founding text",
  );
  try {
    expect(await store.ensureInitialized()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    await store.setText("A later edit");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(harness.committed.length).toBeGreaterThan(1);

    const founding = await readDocumentFoundingUpdate({
      localId: "founding-note",
      runtime: harness.runtime,
      stillCurrent: () => true,
    });

    expect(founding).toMatchObject({
      content: { documentKind: "note", text: "Founding text" },
      seedTag: undefined,
      writerUserId: harness.fixture.author.signerUserId,
    });
    expect(harness.rawRequests).toHaveLength(1);
    expect(harness.rawRequests[0]).toMatchObject({
      historyMode: "raw",
      localVersionVector: null,
      outgoingUpdates: [],
    });
    expect(store.getSnapshot().text).toBe("A later edit");
  } finally {
    harness.close();
  }
}, 10_000);

test("a document without a remote record or network has no founding update to read", async () => {
  const harness = await createFoundingHarness("founding-update-absent");
  const sync = spyOn(RemoteDocumentService.prototype, "syncRemoteDocument");
  try {
    await defaultDocumentsPersistence.ensureSchema(harness.execSql);
    const read = (runtime = harness.runtime) =>
      readDocumentFoundingUpdate({
        localId: "never-synced",
        runtime,
        stillCurrent: () => true,
      });
    expect(await read()).toBeNull();
    expect(
      await read({
        ...harness.runtime,
        state: { ...harness.runtime.state, online: false },
      }),
    ).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  } finally {
    sync.mockRestore();
    harness.close();
  }
});

test("a rotation baseline or an empty history is not a founding update", async () => {
  const harness = await createFoundingHarness("founding-update-baseline");
  const store = createDocumentStore(
    "founding-baseline",
    harness.runtime,
    defaultDocumentsPersistence,
    null,
    "Founding text",
  );
  const sync = spyOn(RemoteDocumentService.prototype, "syncRemoteDocument");
  try {
    expect(await store.ensureInitialized()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    const [first] = harness.committed;
    if (!first) throw new Error("Missing committed update");
    const read = async (
      updates: DocumentSyncResponse["updates"],
      decryptedUpdates: SyncRemoteDocumentResult["decryptedUpdates"],
    ) => {
      sync.mockResolvedValueOnce({
        decryptedUpdates,
        response: { updates },
      } as unknown as SyncRemoteDocumentResult);
      return readDocumentFoundingUpdate({
        localId: "founding-baseline",
        runtime: harness.runtime,
        stillCurrent: () => true,
      });
    };
    expect(await read([], [])).toBeNull();
    expect(
      await read(
        [first],
        [
          {
            checkpointKind: "rotate_baseline",
            checkpointPayloadKind: "full_history_snapshot",
            id: first.id,
            partialEndVersionVector: first.partialEndVersionVector,
            partialStartVersionVector: first.partialStartVersionVector,
            updateData: new Uint8Array(),
          },
        ],
      ),
    ).toBeNull();
  } finally {
    sync.mockRestore();
    harness.close();
  }
}, 10_000);

// A founding view reads an update this device may already hold, so a death
// there must be found like a sync pass's (#3194): it claims the windows dead
// lifetimes left before its pull, and judges and replays the update in a
// window of its own, settled once the view is read.
test("a founding view claims dead windows and reads in a window it settles", async () => {
  const harness = await createFoundingHarness("founding-update-window");
  const removeWebLocks = installFakeWebLocks();
  const opening = spyOn(processLoroLifetimes, "openWindow");
  const store = createDocumentStore(
    "founding-window",
    harness.runtime,
    defaultDocumentsPersistence,
    null,
    "Founding text",
  );
  try {
    expect(await store.ensureInitialized()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    const documentId = store.getSnapshot().documentId;
    if (!documentId) throw new Error("Expected a remote document");
    await writeLoroWindowInTransaction(
      getClientSQLitePersistenceRuntime(harness.execSql).db,
      { appKind: "documents", localId: "founding-window" },
      {
        counts: false,
        documentId,
        judge: documentVerdictJudge(),
        kind: "read",
        lifetimeId: "dead",
        updateIds: ["first-suspect", "second-suspect"],
        windowId: "dead-window",
      },
      "2026-11-23T00:00:00.000Z",
    );
    const openBefore = processLoroLifetimes.openWindowCount();
    const openWhileCurrent: number[] = [];
    opening.mockClear();

    const founding = await readDocumentFoundingUpdate({
      localId: "founding-window",
      runtime: harness.runtime,
      stillCurrent: () => {
        openWhileCurrent.push(processLoroLifetimes.openWindowCount());
        return true;
      },
    });

    expect(founding?.content.text).toBe("Founding text");
    expect(opening).toHaveBeenCalledTimes(1);
    // Asked as the replay begins: the judge's window is still open.
    expect(openWhileCurrent.at(-1)).toBe(openBefore + 1);
    expect(processLoroLifetimes.openWindowCount()).toBe(openBefore);
    expect(
      await harness.execSql("SELECT lifetime_id FROM document_loro_windows"),
    ).toEqual([]);
    expect(
      await harness.execSql("SELECT suspects FROM document_loro_isolation"),
    ).toEqual([
      { suspects: JSON.stringify(["first-suspect", "second-suspect"]) },
    ]);
  } finally {
    opening.mockRestore();
    removeWebLocks();
    harness.close();
  }
}, 10_000);
