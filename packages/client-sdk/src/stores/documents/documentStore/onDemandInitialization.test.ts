import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
  settleWithin,
} from "../../../../test/helpers/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";
import { createRemoteHistoryFixture } from "./documentStore.testFixtures";

test("a cold on-demand store stays local until explicitly requested", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-wait-on-demand");
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      return fixture.response;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "on-demand-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
      "",
      undefined,
      "on-demand",
    );

    expect(await store.ensureInitialized()).toBe(true);
    await settleCoordinator(runtime.state.domainScope);
    expect(syncCalls).toBe(0);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(true);
    expect(syncCalls).toBeGreaterThan(0);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
