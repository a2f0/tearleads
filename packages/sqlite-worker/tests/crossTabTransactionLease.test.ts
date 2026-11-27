import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import {
  createSharedDatabaseRuntime,
  type DatabaseRuntime,
  isDatabaseConnectionLostError,
} from "../src/runtime";
import { DATABASE_TRANSACTION_REVOKED_MESSAGE } from "../src/types";
import { DatabaseTransactionRevokedError } from "../src/workerCrash";
import {
  MockLockManager,
  requireCrossTabWorker,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

// Tabs sharing one owner's real SQLite worker (tests/leaseTestWorker.ts), each
// behind its own coordinator, as in crossTabOwnerHandoff.test.ts.

const CLIENT_LOCK_PREFIX = "tearleads-sqlite-worker-client:";

class LoggingWorker extends Worker {
  static instances: LoggingWorker[] = [];
  // The lease bounds the next owner worker runs with.
  static bounds = { idleMs: 0, waitMs: 0 };
  readonly logs: string[] = [];

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super(scriptURL, {
      ...options,
      env: {
        LEASE_TEST_IDLE_MS: String(LoggingWorker.bounds.idleMs),
        LEASE_TEST_WAIT_MS: String(LoggingWorker.bounds.waitMs),
      },
    });
    LoggingWorker.instances.push(this);
    this.addEventListener("message", (event) => {
      const message = Reflect.get(Object(event.data), "message");
      if (typeof message === "string") {
        this.logs.push(message);
      }
    });
  }

  static terminateAll(): void {
    for (const worker of LoggingWorker.instances.splice(0)) {
      worker.terminate();
    }
  }
}

// Coordinators are keyed by worker URL, so a per-tab query string separates
// them while loading the same script.
function openTab(tab: string): DatabaseRuntime {
  const url = new URL("./leaseTestWorker.ts", import.meta.url);
  url.searchParams.set("tab", `${tab}-${crypto.randomUUID()}`);
  return createSharedDatabaseRuntime(
    requireCrossTabWorker(
      createCrossTabDatabaseWorker(url.href, LoggingWorker),
    ),
  );
}

async function withTabs(
  bounds: { idleMs: number; waitMs: number },
  run: (locks: MockLockManager) => Promise<void>,
): Promise<void> {
  const locks = new MockLockManager();
  LoggingWorker.instances = [];
  LoggingWorker.bounds = bounds;
  try {
    await withCrossTabGlobals(locks, () => run(locks));
  } finally {
    LoggingWorker.terminateAll();
  }
}

function clientLocks(locks: MockLockManager): Set<string> {
  return new Set(
    [...locks.heldLockNames].filter((name) =>
      name.startsWith(CLIENT_LOCK_PREFIX),
    ),
  );
}

function initOptions(dbName: string) {
  return { cipher: "sqlcipher", dbName, key: "secret" } as const;
}

test("a transaction a vanished tab left open is rolled back once the owner sweeps it", async () => {
  // Idle revocation is far off, so only the sweep can free the lease.
  await withTabs({ idleMs: 60_000, waitMs: 8_000 }, async (locks) => {
    const dbName = `lease-sweep-${crypto.randomUUID()}.db`;
    const owner = openTab("owner");
    await owner.client.init(initOptions(dbName));
    await owner.client.exec({ sql: "CREATE TABLE items (value INTEGER)" });

    const before = clientLocks(locks);
    const vanishing = openTab("vanishing");
    await vanishing.client.init(initOptions(dbName));
    const [vanishingLock] = [...clientLocks(locks)].filter(
      (name) => !before.has(name),
    );
    if (!vanishingLock) {
      throw new Error("Expected the second tab's client lock.");
    }
    await vanishing.client.exec({ sql: "BEGIN IMMEDIATE" });
    await vanishing.client.exec({ sql: "INSERT INTO items VALUES (2)" });

    // The tab is discarded: the browser reclaims its client lock.
    locks.forceRelease(vanishingLock);
    const startedAt = performance.now();
    await owner.client.exec({ sql: "INSERT INTO items VALUES (1)" });

    // Freed by the sweep, well before the wait bound would refuse it.
    expect(performance.now() - startedAt).toBeLessThan(4_000);
    expect(LoggingWorker.instances[0]?.logs).toEqual([]);
    expect(await owner.client.exec({ sql: "SELECT value FROM items" })).toEqual(
      { ok: true, rows: [{ value: 1 }] },
    );
  });
}, 15_000);

test("a tab whose transaction is revoked loses its connection and is told why", async () => {
  await withTabs({ idleMs: 100, waitMs: 5_000 }, async () => {
    const dbName = `lease-revoked-${crypto.randomUUID()}.db`;
    const holder = openTab("holder");
    let crash: Error | null = null;
    holder.subscribeWorkerError?.((error) => {
      crash = error;
    });
    await holder.client.init(initOptions(dbName));
    await holder.client.exec({ sql: "CREATE TABLE items (value INTEGER)" });
    await holder.client.exec({ sql: "BEGIN IMMEDIATE" });
    await holder.client.exec({ sql: "INSERT INTO items VALUES (1)" });

    const waiter = openTab("waiter");
    await waiter.client.init(initOptions(dbName));
    const startedAt = performance.now();
    await waiter.client.exec({ sql: "INSERT INTO items VALUES (2)" });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(
      await waiter.client.exec({ sql: "SELECT value FROM items" }),
    ).toEqual({ ok: true, rows: [{ value: 2 }] });

    const error = await holder.client.exec({ sql: "COMMIT" }).then(
      () => null,
      (rejection: unknown) => rejection,
    );
    await waitUntil(() => crash !== null);
    for (const lost of [error, crash]) {
      expect(lost).toBeInstanceOf(DatabaseTransactionRevokedError);
      expect(isDatabaseConnectionLostError(lost)).toBe(true);
    }
    expect(String(crash)).toContain(DATABASE_TRANSACTION_REVOKED_MESSAGE);
    expect(String(crash)).toMatch(
      new RegExp(
        `database ${dbName}, idle \\d+ ms, 1 statement\\(s\\) waiting`,
      ),
    );
    expect(LoggingWorker.instances[0]?.logs).toEqual([
      expect.stringMatching(/^SQLite transaction lease revoked \(database /),
    ]);
  });
}, 15_000);
