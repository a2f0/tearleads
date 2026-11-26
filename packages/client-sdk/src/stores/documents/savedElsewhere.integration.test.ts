import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createProbeRuntime,
  settleCoordinator,
  settleWithin,
} from "../../../test/helpers/workflows/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../workflows/documents";
import { getOrCreateDocumentStore } from "./documentStore";
import { createRemoteHistoryFixture } from "./documentStore/documentStore.testFixtures";
import { requestRemoteSyncsOfRecordsSavedElsewhere } from "./savedElsewhere";

const LOCAL_ID = "shared-note";

/**
 * Two runtimes on one database, as two browser tabs are, and a server that
 * holds the fixture document's first `held.count` updates. It serves the
 * updates after the cursor a request carries, as the real server does, so a
 * request that carries a cursor past what its store holds gets nothing.
 */
async function openTwoTabs(name: string) {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(name);
  const held = { count: 1 };
  const updateIds = fixture.response.updates.map((update) => update.id);
  const serve = (request: DocumentSyncRequest): DocumentSyncResponse => {
    const cursor = request.processedThroughUpdateId;
    const after = cursor === undefined ? 0 : updateIds.indexOf(cursor) + 1;
    return {
      ...fixture.response,
      pullPage: {
        hasMore: false,
        nextCursor: null,
        throughUpdateCount: held.count,
        throughUpdateId: updateIds[held.count - 1] ?? null,
      },
      updates: fixture.response.updates.slice(after, held.count),
    };
  };
  const openTab = () => {
    const requests: DocumentSyncRequest[] = [];
    const runtime = createProbeRuntime({
      execSql: database.execSql,
      fixture,
      syncDocument: async (_documentId, request) => {
        requests.push(request);
        return serve(request);
      },
    });
    const domainScope = runtime.state.domainScope;
    const store = getOrCreateDocumentStore(
      domainScope,
      LOCAL_ID,
      runtime,
      fixture.writerProjection.documentId,
    );
    return { domainScope, requests, store };
  };
  await defaultDocumentsPersistence.ensureSchema(database.execSql);
  return { database, held, openTab };
}

test("a tab that another tab pulled past is asked for one pull, which cites its own version", async () => {
  const { database, held, openTab } = await openTwoTabs("saved-elsewhere");
  const second = openTab();
  let first: ReturnType<typeof openTab> | undefined;
  try {
    // The second tab opens the note and holds the server's one update.
    expect(await second.store.ensureInitialized()).toBe(true);
    expect(await settleWithin(second.store.requestRemoteSyncAndWait())).toBe(
      true,
    );
    expect(second.store.getSnapshot().text).toBe("survives key");
    expect(
      await requestRemoteSyncsOfRecordsSavedElsewhere(
        second.domainScope,
        database.execSql,
      ),
    ).toBe(0);

    // A peer edits the note. The first tab pulls the edit and saves it: the
    // shared record and its processed cursor now cover two updates.
    held.count = 2;
    first = openTab();
    expect(await first.store.ensureInitialized()).toBe(true);
    expect(await settleWithin(first.store.requestRemoteSyncAndWait())).toBe(
      true,
    );
    expect(first.store.getSnapshot().text).toBe("survives key rotation");
    await settleCoordinator(first.domainScope);
    await settleCoordinator(second.domainScope);
    expect(second.store.getSnapshot().text).toBe("survives key");

    // The second tab's catch-up finds its open copy behind the saved record.
    second.requests.length = 0;
    expect(
      await requestRemoteSyncsOfRecordsSavedElsewhere(
        second.domainScope,
        database.execSql,
      ),
    ).toBe(1);
    await settleCoordinator(second.domainScope);

    // Its pull went by its own version: the shared cursor is past what this
    // copy holds, and a request that carried it would have been served
    // nothing. A later pass may carry the cursor, once the copy holds it.
    expect(second.requests[0]?.processedThroughUpdateId).toBeUndefined();
    expect(second.store.getSnapshot().text).toBe("survives key rotation");

    // Both copies now hold what the record has on disk.
    for (const tab of [first, second]) {
      expect(
        await requestRemoteSyncsOfRecordsSavedElsewhere(
          tab.domainScope,
          database.execSql,
        ),
      ).toBe(0);
    }
  } finally {
    disposeDomainSyncCoordinator(second.domainScope);
    if (first) disposeDomainSyncCoordinator(first.domainScope);
    database.close();
  }
});
