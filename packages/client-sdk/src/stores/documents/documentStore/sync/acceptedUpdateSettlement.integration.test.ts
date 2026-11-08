import { expect, test } from "bun:test";
import { decodeVersionVector } from "@tearleads/loro";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncResponse,
} from "@tearleads/validators/response";
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
import {
  defaultDocumentsPersistence,
  listPendingDocumentUpdates,
} from "../../../../workflows/documents";
import type { DocumentsRuntime } from "../../types";
import { createDocumentStore } from "../index";

/**
 * Like the server's frontier filter: an update is missing from the client
 * when one of its spans ends past the version the request advertises.
 */
function passesFrontier(
  update: DocumentSyncResponse["updates"][number],
  localVersionVector: string | null,
): boolean {
  const frontier = decodeVersionVector(localVersionVector);
  for (const [peer, end] of decodeVersionVector(
    update.partialEndVersionVector,
  ).toJSON()) {
    if ((frontier.get(peer) ?? 0) < end) return true;
  }
  return false;
}

/**
 * A documents server that, like the real one, stores each update id once,
 * answers a resubmitted id with an id conflict (the client re-encrypts every
 * attempt, so a resubmission never carries the same bytes), and pulls only
 * updates past the request's frontier. `afterCommit` runs once a submission
 * is committed, while its response is still in flight; `loseNextAck` drops
 * the next committed submission's response.
 */
async function createServerHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(name);
  const submittedIds: string[] = [];
  const committed: DocumentSyncResponse["updates"] = [];
  const hooks: {
    afterCommit: (() => Promise<void>) | null;
    loseNextAck: boolean;
  } = { afterCommit: null, loseNextAck: false };
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
    async syncDocumentResult(documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) throw new Error("document not created");
      const ids = request.outgoingUpdates.map((update) => update.id);
      submittedIds.push(...ids);
      if (ids.some((id) => committed.some((update) => update.id === id))) {
        return createMockRequestFailure({
          code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
          message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
          status: 409,
        });
      }
      const echo = createEchoDocumentSyncResponse({
        commitLsn: `0/${submittedIds.length + 1}0`,
        request,
        storedDocument,
      });
      committed.push(...echo.updates);
      if (ids.length > 0 && hooks.afterCommit) {
        const afterCommit = hooks.afterCommit;
        hooks.afterCommit = null;
        await afterCommit();
      }
      if (ids.length > 0 && hooks.loseNextAck) {
        hooks.loseNextAck = false;
        throw new Error("connection reset after commit");
      }
      const updates = committed.filter((update) =>
        passesFrontier(update, request.localVersionVector),
      );
      return { data: { ...echo, updates }, ok: true };
    },
  });
  const online = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
  const offline: DocumentsRuntime = {
    ...online,
    state: { ...online.state, online: false },
  };
  const committedIds = () => committed.map((update) => update.id);
  return { close, committedIds, execSql, hooks, offline, online, submittedIds };
}

async function typeOffline(
  harness: Awaited<ReturnType<typeof createServerHarness>>,
  localId: string,
  text: string,
) {
  const store = createDocumentStore(
    localId,
    harness.offline,
    defaultDocumentsPersistence,
    null,
    "",
    "note",
  );
  expect(await store.ensureInitialized()).toBe(true);
  for (let length = 1; length <= text.length; length += 1) {
    await store.setText(text.slice(0, length));
  }
  return store;
}

function queued(
  execSql: DocumentsRuntime["infra"]["execSql"],
  localId: string,
) {
  return listPendingDocumentUpdates({
    execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
}

// A new note's record has no access-state hash until discovery records one.
// When that refresh lands while the note's first sync response is being
// persisted, the response loses its compare-and-set, but the updates the
// server just acknowledged must still settle. Left queued, the next pass
// resubmits their ids, the server rejects the batch as an id conflict, and
// recovery re-keys the rows, so the server stores every operation twice.
test("an access-state refresh during a sync still settles acknowledged updates", async () => {
  const localId = "settle-during-access-refresh";
  const harness = await createServerHarness(localId);
  try {
    const text = "offline burst";
    const store = await typeOffline(harness, localId, text);
    harness.hooks.afterCommit = async () => {
      await harness.execSql(
        "UPDATE documents SET access_state_hash = ? WHERE local_id = ?",
        ["refreshed-access-state", localId],
      );
    };

    store.updateRuntime(harness.online);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    await store.requestRemoteSyncAndWait();

    expect(harness.hooks.afterCommit).toBeNull();
    expect(await queued(harness.execSql, localId)).toEqual([]);
    // Every update reached the server exactly once, under one id.
    expect(harness.submittedIds).toEqual(harness.committedIds());
    expect(store.getSnapshot().text).toBe(text);
  } finally {
    harness.close();
  }
});

// A response lost after the server committed leaves the update queued, so the
// next pass resubmits its id and gets an id conflict. The recovery pull must
// ask for the server's copy (the live version already covers the update, so
// advertising it would hide that copy) and settle the row by content rather
// than re-key it into a second upload of the same operations.
test("recovery after a lost ack settles from the server's copy instead of re-keying", async () => {
  const localId = "settle-after-lost-ack";
  const harness = await createServerHarness(localId);
  try {
    const text = "lost ack";
    const store = await typeOffline(harness, localId, text);
    harness.hooks.loseNextAck = true;

    store.updateRuntime(harness.online);
    await store.requestRemoteSyncAndWait();
    const [sentId] = harness.submittedIds;
    if (sentId === undefined) throw new Error("expected one submission");
    expect(harness.committedIds()).toEqual([sentId]);
    expect(
      (await queued(harness.execSql, localId)).map(({ id }) => id),
    ).toEqual([sentId]);

    await store.requestRemoteSyncAndWait();
    await store.requestRemoteSyncAndWait();

    expect(harness.submittedIds).toEqual([sentId, sentId]);
    expect(harness.committedIds()).toEqual([sentId]);
    expect(await queued(harness.execSql, localId)).toEqual([]);
    expect(store.getSnapshot().text).toBe(text);
  } finally {
    harness.close();
  }
});
