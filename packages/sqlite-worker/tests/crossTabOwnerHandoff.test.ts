import { expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "../src/client";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import {
  createSharedDatabaseRuntime,
  type DatabaseRuntime,
  isDatabaseConnectionLostError,
} from "../src/runtime";
import { DatabaseWorkerCrashError } from "../src/workerCrash";
import {
  closeFirstCrossTabChannel,
  MockLockManager,
  PortAwareWorker,
  requireCrossTabWorker,
  ThrowingWorker,
  uniqueWorkerUrl,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

// These tests run the real SQLite worker (tests/testWorker.ts) behind each tab's
// coordinator, because the failure lives in the worker's per-connection state:
// a database opened through one owner's worker does not exist in the next
// owner's worker.

const OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";
const INIT_OPTIONS = {
  dbName: "handoff.db",
  cipher: "sqlcipher",
  key: "secret",
} as const;

class TrackedWorker extends Worker {
  static instances: TrackedWorker[] = [];
  terminated = false;

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super(scriptURL, options);
    TrackedWorker.instances.push(this);
  }

  override terminate(): void {
    this.terminated = true;
    super.terminate();
  }

  static terminateAll(): void {
    for (const worker of TrackedWorker.instances.splice(0)) {
      worker.terminate();
    }
  }
}

// Each simulated tab gets its own coordinator: coordinators are keyed by worker
// URL, so a per-tab query string separates them while loading the same script.
function tabWorkerUrl(tab: string): string {
  return new URL(
    `./testWorker.ts?tab=${tab}-${crypto.randomUUID()}`,
    import.meta.url,
  ).href;
}

function openTab(workerUrl: string): DatabaseRuntime {
  return createSharedDatabaseRuntime(
    requireCrossTabWorker(
      createCrossTabDatabaseWorker(workerUrl, TrackedWorker),
    ),
  );
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function observeCrash(runtime: DatabaseRuntime): () => Error | null {
  let crash: Error | null = null;
  runtime.subscribeWorkerError?.((error) => {
    crash = error;
  });
  return () => crash;
}

// The owner tab is discarded: its channel stops delivering, the browser
// reclaims its owner lock, and its worker thread dies with it.
function discardOwnerTab(locks: MockLockManager, ownerWorker: TrackedWorker) {
  closeFirstCrossTabChannel();
  ownerWorker.terminate();
  locks.forceRelease(OWNER_LOCK_NAME);
}

async function withRealWorkerTabs(
  run: (locks: MockLockManager) => Promise<void>,
): Promise<void> {
  const locks = new MockLockManager();
  TrackedWorker.instances = [];
  try {
    await withCrossTabGlobals(locks, () => run(locks));
  } finally {
    TrackedWorker.terminateAll();
  }
}

test("a promoted tab's open database fails as lost instead of reporting it uninitialized", async () => {
  await withRealWorkerTabs(async (locks) => {
    const ownerTab = openTab(tabWorkerUrl("owner"));
    await ownerTab.client.ping();
    const [ownerWorker] = TrackedWorker.instances;
    if (!ownerWorker) {
      throw new Error("Expected the owner tab to construct its worker.");
    }

    const promotedUrl = tabWorkerUrl("promoted");
    const survivor = openTab(promotedUrl);
    const survivorCrash = observeCrash(survivor);
    await survivor.client.init(INIT_OPTIONS);
    await survivor.client.exec({ sql: "CREATE TABLE t (x INTEGER)" });
    await survivor.client.exec({ sql: "INSERT INTO t VALUES (42)" });

    discardOwnerTab(locks, ownerWorker);
    await waitUntil(() => TrackedWorker.instances.length === 2);

    // Promotion itself reports the loss, before the next statement is sent.
    await waitUntil(() => survivorCrash() !== null);
    expect(isDatabaseConnectionLostError(survivorCrash())).toBe(true);
    expect(String(survivorCrash())).toContain("connection was lost");
    const error = await rejectionOf(
      survivor.client.exec({ sql: "SELECT x FROM t" }),
    );
    expect(String(error)).toContain(
      "Database worker failed. The database connection was lost",
    );

    // The host retires the lost runtime. Its teardown must not stop the owner
    // this tab was just promoted to, or ownership would bounce between tabs.
    const promotedOwner = TrackedWorker.instances[1];
    await rejectionOf(survivor.client.close());
    survivor.terminateNow();
    expect(promotedOwner?.terminated).toBe(false);

    // A fresh runtime opens the database on the promoted owner.
    const reopened = openTab(promotedUrl);
    await reopened.client.init(INIT_OPTIONS);
    await reopened.client.exec({ sql: "CREATE TABLE t (x INTEGER)" });
    expect(
      await reopened.client.exec({ sql: "SELECT count(*) AS n FROM t" }),
    ).toEqual({ ok: true, rows: [{ n: 0 }] });
    expect(TrackedWorker.instances).toHaveLength(2);
    reopened.terminateNow();
    ownerTab.terminateNow();
  });
});

test("a tab served by another tab's new owner learns its database was lost", async () => {
  await withRealWorkerTabs(async (locks) => {
    const ownerTab = openTab(tabWorkerUrl("owner"));
    await ownerTab.client.ping();
    const [ownerWorker] = TrackedWorker.instances;
    if (!ownerWorker) {
      throw new Error("Expected the owner tab to construct its worker.");
    }

    // Queued first, so this tab is the one promoted when the owner goes.
    const successorTab = openTab(tabWorkerUrl("successor"));
    await successorTab.client.ping();

    const remoteUrl = tabWorkerUrl("remote");
    const remote = openTab(remoteUrl);
    const remoteCrash = observeCrash(remote);
    await remote.client.init(INIT_OPTIONS);
    await remote.client.exec({ sql: "CREATE TABLE t (x INTEGER)" });

    discardOwnerTab(locks, ownerWorker);
    await waitUntil(() => TrackedWorker.instances.length === 2);

    const error = await rejectionOf(
      remote.client.exec({ sql: "SELECT x FROM t" }),
    );
    expect(isDatabaseConnectionLostError(error)).toBe(true);
    expect(String(error)).toContain("connection was lost");
    // The same loss reaches the host, which retires the runtime.
    expect(remoteCrash() === error).toBe(true);

    // Later requests fail at once rather than reaching the new owner.
    expect(
      String(await rejectionOf(remote.client.exec({ sql: "SELECT 1" }))),
    ).toContain("connection was lost");

    remote.terminateNow();
    const reopened = openTab(remoteUrl);
    await reopened.client.init(INIT_OPTIONS);
    expect(await reopened.client.exec({ sql: "SELECT 1 AS one" })).toEqual({
      ok: true,
      rows: [{ one: 1 }],
    });
    reopened.terminateNow();
    successorTab.terminateNow();
    ownerTab.terminateNow();
  });
});

test("a database another tab deleted is not reopened behind it", async () => {
  await withRealWorkerTabs(async (locks) => {
    const ownerTab = openTab(tabWorkerUrl("owner"));
    await ownerTab.client.init(INIT_OPTIONS);
    const [ownerWorker] = TrackedWorker.instances;
    if (!ownerWorker) {
      throw new Error("Expected the owner tab to construct its worker.");
    }

    const sibling = openTab(tabWorkerUrl("sibling"));
    const siblingCrash = observeCrash(sibling);
    await sibling.client.init(INIT_OPTIONS);
    await sibling.client.exec({ sql: "SELECT 1" });

    // Logout and destroying an identity delete the database on purpose; a
    // sibling tab must not treat that as a loss and open it again.
    await ownerTab.client.delete();

    const error = await rejectionOf(sibling.client.exec({ sql: "SELECT 1" }));
    expect(error).not.toBeInstanceOf(DatabaseWorkerCrashError);
    expect(String(error)).toContain(
      "Database was deleted by another connection.",
    );
    expect(siblingCrash()).toBeNull();

    // The deleting tab then closes. Taking ownership must not turn the
    // deleted database into a lost one that the host would open again.
    discardOwnerTab(locks, ownerWorker);
    await waitUntil(() => TrackedWorker.instances.length === 2);
    const afterHandoff = await rejectionOf(
      sibling.client.exec({ sql: "SELECT 1" }),
    );
    expect(afterHandoff).not.toBeInstanceOf(DatabaseWorkerCrashError);
    expect(siblingCrash()).toBeNull();
    sibling.terminateNow();
    ownerTab.terminateNow();
  });
});

test("a delete the sibling never queried survives the deleting tab closing", async () => {
  await withRealWorkerTabs(async (locks) => {
    const ownerTab = openTab(tabWorkerUrl("owner"));
    await ownerTab.client.init(INIT_OPTIONS);
    const [ownerWorker] = TrackedWorker.instances;
    if (!ownerWorker) {
      throw new Error("Expected the owner tab to construct its worker.");
    }

    const sibling = openTab(tabWorkerUrl("sibling"));
    const siblingCrash = observeCrash(sibling);
    await sibling.client.init(INIT_OPTIONS);

    // The sibling sends nothing between the delete and the deleting tab
    // closing; the worker's notice alone must keep it from being reopened.
    await ownerTab.client.delete();
    discardOwnerTab(locks, ownerWorker);
    await waitUntil(() => TrackedWorker.instances.length === 2);

    const error = await rejectionOf(sibling.client.exec({ sql: "SELECT 1" }));
    expect(error).not.toBeInstanceOf(DatabaseWorkerCrashError);
    expect(siblingCrash()).toBeNull();
    sibling.terminateNow();
    ownerTab.terminateNow();
  });
});

// Answers every request except a teardown, which stays in flight.
class TeardownHangingWorker extends PortAwareWorker {
  override postMessage(_message: unknown, transfer?: Transferable[]): void {
    const port = transfer?.[0];
    if (!(port instanceof MessagePort)) {
      return;
    }
    this.ports.push(port);
    port.start();
    port.addEventListener("message", (event) => {
      const { id, method } = event.data as { id: number; method: string };
      if (method !== "close" && method !== "delete") {
        port.postMessage({ id, result: { ok: true } });
      }
    });
  }
}

test("a client mid-teardown at promotion is lost and leaves the new owner alone", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    const ownerWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("owner"),
        TeardownHangingWorker,
      ),
    );
    const ownerClient = createDatabaseWorkerClient(ownerWorker);
    await ownerClient.ping();
    const hangingOwner = PortAwareWorker.lastConstructed;

    PortAwareWorker.lastConstructed = null;
    const promotedWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("closing"), PortAwareWorker),
    );
    const promotedRuntime = createSharedDatabaseRuntime(promotedWorker);
    await promotedRuntime.client.init(INIT_OPTIONS);
    const pendingDelete = rejectionOf(promotedRuntime.deleteData());
    await waitUntil(() => hangingOwner?.ports.length === 2);

    locks.forceRelease(OWNER_LOCK_NAME);
    await pendingDelete;
    const promotedOwner =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    expect(promotedOwner).not.toBeNull();
    // Its teardown is over without force-stopping the owner it never used.
    expect(promotedOwner?.terminated).toBe(false);
    ownerClient.destroy();
    ownerWorker.close();
  });
});

test("a tab whose own owner fails to start still reports its database lost", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    // The owner tab answers every request, so the other tab's init binds it.
    const ownerWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("owner"), PortAwareWorker),
    );
    const ownerClient = createDatabaseWorkerClient(ownerWorker);
    await ownerClient.ping();

    const promotedWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("broken"), ThrowingWorker),
    );
    const crashes: unknown[] = [];
    promotedWorker.addEventListener("error", (event) => {
      crashes.push(event instanceof ErrorEvent ? event.error : event);
    });
    const promotedClient = createDatabaseWorkerClient(promotedWorker);
    await promotedClient.init(INIT_OPTIONS);

    // Promoted, its own owner worker throws on construction. The owner that
    // held its database is gone either way.
    locks.forceRelease(OWNER_LOCK_NAME);
    await waitUntil(() => crashes.length === 1);
    expect(isDatabaseConnectionLostError(crashes[0])).toBe(true);

    const error = await rejectionOf(promotedClient.exec({ sql: "SELECT 1" }));
    expect(String(error)).toContain("connection was lost");
    promotedClient.destroy();
    promotedWorker.close();
    ownerClient.destroy();
    ownerWorker.close();
  });
});

test("a database that was never opened still reports itself uninitialized", async () => {
  await withRealWorkerTabs(async () => {
    const tab = openTab(tabWorkerUrl("solo"));
    const crash = observeCrash(tab);

    const error = await rejectionOf(tab.client.exec({ sql: "SELECT 1" }));
    expect(error).not.toBeInstanceOf(DatabaseWorkerCrashError);
    expect(String(error)).toContain("Database has not been initialized.");
    expect(crash()).toBeNull();

    await tab.client.init(INIT_OPTIONS);
    expect(await tab.client.exec({ sql: "SELECT 1 AS one" })).toEqual({
      ok: true,
      rows: [{ one: 1 }],
    });
    tab.terminateNow();
  });
});
