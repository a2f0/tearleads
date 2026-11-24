import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
} from "../../../../../test/helpers/workflows/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createRemoteHistoryFixture } from "../documentStore.testFixtures";
import { getOrCreateDocumentStore } from "../index";

// A listing opens documents on demand to read them; a view that opens the same
// shared store later with the default mode still gets its startup probe.
async function withOnDemandStore(
  name: string,
  run: (input: {
    open: (mode?: "on-demand") => ReturnType<typeof getOrCreateDocumentStore>;
    settle: () => Promise<void>;
    syncCalls: () => number;
  }) => Promise<void>,
) {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(name);
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
    await run({
      open: (mode) =>
        getOrCreateDocumentStore(
          runtime.state.domainScope,
          name,
          runtime,
          fixture.writerProjection.documentId,
          "",
          undefined,
          mode ? { remoteSyncMode: mode } : {},
        ),
      settle: () => settleCoordinator(runtime.state.domainScope),
      syncCalls: () => syncCalls,
    });
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
}

test("a startup open before the on-demand store loads runs the startup probe", async () => {
  await withOnDemandStore("startup-join-before-load", async (input) => {
    const store = input.open("on-demand");
    expect(input.open()).toBe(store);

    expect(await store.ensureInitialized()).toBe(true);
    await input.settle();
    expect(input.syncCalls()).toBeGreaterThan(0);
  });
});

test("a startup open after the on-demand store loads runs the skipped probe", async () => {
  await withOnDemandStore("startup-join-after-load", async (input) => {
    const store = input.open("on-demand");
    expect(await store.ensureInitialized()).toBe(true);
    await input.settle();
    expect(input.syncCalls()).toBe(0);

    expect(input.open("on-demand")).toBe(store);
    await input.settle();
    expect(input.syncCalls()).toBe(0);

    expect(input.open()).toBe(store);
    await input.settle();
    const probed = input.syncCalls();
    expect(probed).toBeGreaterThan(0);

    // The probe runs once per session, not once per later open.
    expect(input.open()).toBe(store);
    await input.settle();
    expect(input.syncCalls()).toBe(probed);
  });
});
