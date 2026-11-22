import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
  settleWithin,
} from "../../../../../test/helpers/workflows/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createRemoteHistoryFixture } from "../documentStore.testFixtures";
import { createDocumentStore } from "../index";

test("a failed continuation keeps a paginated remote probe incomplete", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-wait-pagination-null");
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        return {
          ...fixture.response,
          pullPage: {
            hasMore: true,
            nextCursor: "profile-page-2",
            throughUpdateId: null,
          },
          updates: [],
        };
      }
      return null;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "paginated-null-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
      "",
      undefined,
      { remoteSyncMode: "on-demand" },
    );
    expect(await store.ensureInitialized()).toBe(true);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    expect(syncCalls).toBe(2);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("aborting a waiter preserves every page of an independent refresh", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(
    "remote-sync-wait-paginated-refresh-abort",
  );
  let releaseFinalPage: () => void = () => undefined;
  const finalPageGate = new Promise<void>((resolve) => {
    releaseFinalPage = resolve;
  });
  let markFinalPageStarted: () => void = () => undefined;
  const finalPageStarted = new Promise<void>((resolve) => {
    markFinalPageStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        return {
          ...fixture.response,
          pullPage: {
            hasMore: true,
            nextCursor: "profile-page-2",
            throughUpdateId: null,
          },
          updates: [],
        };
      }
      if (syncCalls === 2) {
        markFinalPageStarted();
        await finalPageGate;
        return fixture.response;
      }
      return {
        ...fixture.response,
        updates: [],
      };
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "paginated-refresh-abort-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    store.requestRemoteSync();
    await settleWithin(finalPageStarted, "final continuation page");

    const abortController = new AbortController();
    const aborted = store.requestRemoteSyncAndWait(abortController.signal);
    abortController.abort();
    expect(await settleWithin(aborted)).toBe(false);

    releaseFinalPage();
    await settleCoordinator(runtime.state.domainScope);

    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "paginated-refresh-abort-profile",
    );
    expect(syncCalls).toBeGreaterThanOrEqual(2);
    expect(persisted.document?.text).toBe("survives key rotation");
  } finally {
    releaseFinalPage();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
