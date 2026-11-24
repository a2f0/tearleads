import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
} from "../../../../../test/helpers/workflows/remoteSyncWait";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import type { DocumentsRuntime } from "../../types";
import { createRemoteHistoryFixture } from "../documentStore.testFixtures";
import { getOrCreateDocumentStore } from "../index";

const STARTUP_PROBE_LOG =
  "Documents: remote revalidation scheduled reason=startup";

// A listing opens documents on demand to read them; a view that opens the same
// shared store later with the default mode still gets its startup probe.
async function withOnDemandStore(
  name: string,
  run: (input: {
    logs: ReadonlyArray<string>;
    open: (mode?: "on-demand") => ReturnType<typeof getOrCreateDocumentStore>;
    runtime: DocumentsRuntime;
    settle: () => Promise<void>;
    syncCalls: () => number;
  }) => Promise<void>,
) {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(name);
  let syncCalls = 0;
  const logs: string[] = [];
  const probeRuntime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      return fixture.response;
    },
  });
  const runtime: DocumentsRuntime = {
    ...probeRuntime,
    util: { ...probeRuntime.util, log: (message) => logs.push(message) },
  };
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    await run({
      logs,
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
      runtime,
      // A joining open arms its probe in a microtask; let it run first.
      settle: async () => {
        await Promise.resolve();
        await settleCoordinator(runtime.state.domainScope);
      },
      syncCalls: () => syncCalls,
    });
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
}

function withPendingConnectAttempt(
  runtime: DocumentsRuntime,
  attempt: number | undefined,
): DocumentsRuntime {
  return {
    ...runtime,
    state: { ...runtime.state, serverEventsPendingConnectAttempt: attempt },
  };
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

test("a startup open arms the probe after the open returns, never during it", async () => {
  await withOnDemandStore("startup-join-deferred", async (input) => {
    const store = input.open("on-demand");
    expect(await store.ensureInitialized()).toBe(true);
    await input.settle();

    // A view may open the store during a render: nothing is published yet.
    input.open();
    expect(input.logs).not.toContain(STARTUP_PROBE_LOG);

    await input.settle();
    expect(input.logs).toContain(STARTUP_PROBE_LOG);
    expect(input.syncCalls()).toBeGreaterThan(0);
  });
});

test("a joined probe waits on a connect attempt in flight, then runs when it ends", async () => {
  await withOnDemandStore("startup-join-pending-connect", async (input) => {
    const store = input.open("on-demand");
    expect(await store.ensureInitialized()).toBe(true);
    await input.settle();

    store.updateRuntime(withPendingConnectAttempt(input.runtime, 7));
    input.open();
    await input.settle();
    expect(input.syncCalls()).toBe(0);

    // The attempt ended without an acknowledgement, so no reconnect probe
    // covers the deferred startup probe: it runs now.
    store.updateRuntime(withPendingConnectAttempt(input.runtime, undefined));
    await input.settle();
    expect(input.syncCalls()).toBeGreaterThan(0);
  });
});

test("a startup open after a requested remote pass adds no second probe", async () => {
  await withOnDemandStore("startup-join-after-pass", async (input) => {
    const store = input.open("on-demand");
    expect(await store.ensureInitialized()).toBe(true);
    expect(
      await store.requestRemoteSyncAndWait(new AbortController().signal),
    ).toBe(true);
    await input.settle();
    const passed = input.syncCalls();
    expect(passed).toBeGreaterThan(0);

    input.open();
    await input.settle();
    expect(input.syncCalls()).toBe(passed);
    expect(input.logs).not.toContain(STARTUP_PROBE_LOG);
  });
});
