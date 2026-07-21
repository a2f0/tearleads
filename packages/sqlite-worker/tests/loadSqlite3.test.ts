import { expect, test } from "bun:test";
import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import {
  execDatabaseStatement,
  initDatabase,
  installSahPoolVfsWithRetry,
  isAccessHandleContentionError,
  loadSqlite3,
  persistentSahPoolStorageForDbName,
} from "../src/loadSqlite3";
import { SahPoolStepTimeoutError } from "../src/sahPoolHangTimeout";

type SahPoolUtil = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;

// A DOMException-like error matching the browser's lock-contention failure: the
// new worker's SAHPool install collides with the previous worker's not-yet-freed
// OPFS access handles. We can't reproduce real OPFS in Bun, so we model the exact
// error the install throws and assert the retry/fail-fast policy around it.
function accessHandleContentionError(): Error {
  const error = new Error(
    "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': " +
      "Access Handles cannot be created if there is another open Access Handle " +
      "or Writable stream associated with the same file.",
  );
  error.name = "NoModificationAllowedError";
  return error;
}

// Minimal sqlite3 stand-in exposing only installOpfsSAHPoolVfs, which is all
// installSahPoolVfsWithRetry touches. Records attempt count so tests can assert
// how many times the install was tried.
function fakeSqlite3WithInstall(install: () => Promise<SahPoolUtil>): {
  installOptions: () => unknown[];
  sqlite3: Sqlite3Static;
  attempts: () => number;
} {
  let attempts = 0;
  const installOptions: unknown[] = [];
  const sqlite3 = {
    installOpfsSAHPoolVfs: (options: unknown) => {
      attempts += 1;
      installOptions.push(options);
      return install();
    },
  } as unknown as Sqlite3Static;
  return {
    installOptions: () => installOptions,
    sqlite3,
    attempts: () => attempts,
  };
}

test("loadSqlite3 returns the sqlite3 API", async () => {
  const sqlite3 = await loadSqlite3();

  expect(sqlite3).toBeDefined();
  expect(sqlite3.oo1).toBeDefined();
  expect(sqlite3.oo1.DB).toBeFunction();
  expect(sqlite3.version.libVersion).toBeString();
});

test("loadSqlite3 returns the same instance on subsequent calls", async () => {
  const a = await loadSqlite3();
  const b = await loadSqlite3();

  expect(a).toBe(b);
});

test("initDatabase opens an encrypted database", async () => {
  const db = await initDatabase({
    dbName: "/test-init.db",
    cipher: "chacha20",
    key: "test-secret",
  });

  db.exec("CREATE TABLE t(x TEXT)");
  db.exec("INSERT INTO t VALUES('hello from wasm')");

  const rows = db.exec("SELECT x FROM t", { returnValue: "resultRows" });
  expect(rows).toEqual([["hello from wasm"]]);

  db.close();
});

test("initDatabase opens an explicit in-memory database", async () => {
  const db = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key: "test-secret",
    persistence: "memory",
  });

  try {
    db.exec("CREATE TABLE t(x TEXT)");
    db.exec("INSERT INTO t VALUES('still here')");
    expect(db.exec("SELECT x FROM t", { returnValue: "resultRows" })).toEqual([
      ["still here"],
    ]);
  } finally {
    db.close();
  }
});

test("initDatabase hard-fails when persistence is requested without OPFS", async () => {
  // Bun's test runtime has no navigator.storage / OPFS, so the SAHPool VFS
  // cannot be installed. Persistence is opt-in and must throw rather than
  // silently falling back to an in-memory database.
  expect(
    initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "test-secret",
      persistence: "opfs-sahpool",
    }),
  ).rejects.toThrow();
});

test("execDatabaseStatement supports positional binds and array row mode", async () => {
  const db = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key: "test-secret",
  });

  try {
    execDatabaseStatement(db, {
      sql: "CREATE TABLE t(id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
    });
    execDatabaseStatement(db, {
      sql: "INSERT INTO t(id, label) VALUES (?, ?)",
      bind: [1, "one"],
    });

    expect(
      execDatabaseStatement(db, {
        sql: "SELECT label FROM t WHERE id = ?",
        bind: [1],
        rowMode: "array",
      }),
    ).toEqual([["one"]]);
    expect(
      execDatabaseStatement(db, {
        sql: "SELECT label FROM t WHERE id = :id",
        bind: { ":id": 1 },
      }),
    ).toEqual([{ label: "one" }]);
  } finally {
    db.close();
  }
});

test("isAccessHandleContentionError matches the lock-contention failure only", () => {
  // Matched by DOMException name...
  expect(isAccessHandleContentionError(accessHandleContentionError())).toBe(
    true,
  );
  // ...and by message text, in case the name is lost when the error is rewrapped
  // as a plain Error by the SAHPool installer.
  expect(
    isAccessHandleContentionError(
      new Error("... Access Handles cannot be created ..."),
    ),
  ).toBe(true);

  // Unrelated failures (no OPFS, missing wasm, anything else) must NOT match, so
  // they fail fast instead of being retried.
  expect(isAccessHandleContentionError(new Error("Cannot install OPFS"))).toBe(
    false,
  );
  expect(isAccessHandleContentionError(null)).toBe(false);
  expect(isAccessHandleContentionError("a string")).toBe(false);
});

test("persistent SAHPool storage is stable and database-scoped", () => {
  expect(persistentSahPoolStorageForDbName("/app-identity-abcd.db")).toEqual({
    directory: "/tearleads-sqlite/app-identity-abcd.db",
    vfsName: "tearleads-opfs-sahpool-app-identity-abcd.db",
  });
  expect(persistentSahPoolStorageForDbName("/other/identity.db")).toEqual({
    directory: "/tearleads-sqlite/other_identity.db",
    vfsName: "tearleads-opfs-sahpool-other_identity.db",
  });
  expect(persistentSahPoolStorageForDbName(".")).toEqual({
    directory: "/tearleads-sqlite/default",
    vfsName: "tearleads-opfs-sahpool-default",
  });
  expect(persistentSahPoolStorageForDbName("..")).toEqual({
    directory: "/tearleads-sqlite/default",
    vfsName: "tearleads-opfs-sahpool-default",
  });
});

// Regression for the reload/second-tab boot failure: after the OPFS-SAHPool
// backend (PR #980) shipped, reloading the app (or opening a second tab on the
// same origin) made the SQLite worker's SAHPool install collide with the
// previous worker's not-yet-released OPFS access handles, throwing
// NoModificationAllowedError and leaving the database stuck in `status: "error"`
// ("Failed to initialize SQLite for local identity"). The handles free up within
// a tick of the old worker's teardown, so a bounded retry must turn that
// transient race into a successful boot.
test("installSahPoolVfsWithRetry retries past transient access-handle contention", async () => {
  const poolUtil = { vfsName: "tearleads-opfs-sahpool" } as SahPoolUtil;
  let remainingFailures = 3;
  const { sqlite3, attempts, installOptions } = fakeSqlite3WithInstall(
    async () => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw accessHandleContentionError();
      }
      return poolUtil;
    },
  );

  // Override the budget/delays for a fast test (production waits several seconds
  // of real time); the behavior under test is retry-until-success, not timing.
  await expect(
    installSahPoolVfsWithRetry(sqlite3, {
      directory: "/tearleads-sqlite/test-db",
      totalBudgetMs: 10_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
      vfsName: "tearleads-opfs-sahpool-test-db",
    }),
  ).resolves.toBe(poolUtil);
  // Three contention failures, then success on the fourth attempt.
  expect(attempts()).toBe(4);
  expect(installOptions()[0]).toMatchObject({
    clearOnInit: false,
    directory: "/tearleads-sqlite/test-db",
    name: "tearleads-opfs-sahpool-test-db",
  });
});

// The other half of the contract: a failure that will never clear by waiting
// (no OPFS, missing wasm on an offline reload) must propagate on the FIRST
// attempt. Retrying it would only delay Explorer's boot-error/Retry surface,
// which keys off `status: "error"` (see ExplorerDatabaseErrorStatus and the
// offline-boot test). So persistence stays fail-fast for permanent failures.
test("installSahPoolVfsWithRetry fails fast on a non-contention error", async () => {
  const { sqlite3, attempts } = fakeSqlite3WithInstall(() => {
    return Promise.reject(
      new Error("Cannot install OPFS: missing sqlite3.wasm (offline)."),
    );
  });

  await expect(
    installSahPoolVfsWithRetry(sqlite3, {
      totalBudgetMs: 10_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
    }),
  ).rejects.toThrow(/Cannot install OPFS/);
  // Fails on the first attempt despite a generous budget — never retried.
  expect(attempts()).toBe(1);
});

// Even pure contention is bounded: a worker whose handles never free (e.g. a
// wedged sibling tab) must give up and surface an error rather than retry
// forever and hang the boot. We drive a fake clock so the wall-clock budget is
// exhausted deterministically without waiting real seconds.
test("installSahPoolVfsWithRetry gives up once its wall-clock budget is exhausted", async () => {
  const { sqlite3, attempts } = fakeSqlite3WithInstall(() =>
    Promise.reject(accessHandleContentionError()),
  );

  // Each call to now() advances 1000ms, so a 3000ms budget allows only a couple
  // of retries before the next backoff would overrun it.
  let clock = 0;
  const now = () => {
    const value = clock;
    clock += 1000;
    return value;
  };

  await expect(
    installSahPoolVfsWithRetry(sqlite3, {
      totalBudgetMs: 3_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
      now,
    }),
  ).rejects.toThrow(/Access Handles cannot be created/);
  // Bounded: it stops once the budget is spent instead of retrying forever.
  expect(attempts()).toBeGreaterThanOrEqual(1);
  expect(attempts()).toBeLessThanOrEqual(4);
});

// Regression for the Android new-identity boot hang: on Android WebView, under
// per-origin SyncAccessHandle pressure (a previous identity's worker still
// releasing its handles when the next identity's worker boots),
// `createSyncAccessHandle` inside installOpfsSAHPoolVfs can HANG — never resolving
// and never rejecting. The retry loop only reacts to a *thrown* contention error,
// so a hung attempt left initDatabase unsettled forever; the worker went silent
// and the ONLY timer that ever fired was the app's 15s boot-round-trip timeout,
// after which a fresh worker hit the exact same hang. A per-step hang timeout must
// turn that silent hang into a fast, surfaced rejection.
test("installSahPoolVfsWithRetry surfaces a hung install as a bounded rejection", async () => {
  // An install that never settles — models a hung createSyncAccessHandle.
  const { sqlite3, attempts } = fakeSqlite3WithInstall(
    () => new Promise<never>(() => {}),
  );

  const startedAt = Date.now();
  let caught: unknown;
  try {
    await installSahPoolVfsWithRetry(sqlite3, {
      // A large budget on purpose: the hang timeout — not the budget — is what must
      // bound this. If the hang were not caught, this would never settle.
      totalBudgetMs: 60_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
      stepHangTimeoutMs: 50,
    });
  } catch (error) {
    caught = error;
  }
  const elapsedMs = Date.now() - startedAt;

  // It rejects (does not hang) with the hang-timeout signature, promptly.
  expect(caught).toBeInstanceOf(SahPoolStepTimeoutError);
  expect(elapsedMs).toBeLessThan(2_000);
  // A hang is surfaced, NOT retried in place: a second concurrent install would
  // only pile more half-open handles onto the already-saturated origin. Exactly
  // one attempt is made; the app re-boots on a fresh worker instead.
  expect(attempts()).toBe(1);
});

// The complementary half: a healthy install that resolves normally must not be
// tripped by the hang guard, and a *thrown* contention error is still retried in
// place (desktop behaviour) rather than being mistaken for a hang.
test("installSahPoolVfsWithRetry does not trip the hang guard on a healthy or throwing install", async () => {
  const poolUtil = { vfsName: "tearleads-opfs-sahpool" } as SahPoolUtil;

  // Healthy: resolves immediately, well within the hang timeout.
  const healthy = fakeSqlite3WithInstall(async () => poolUtil);
  await expect(
    installSahPoolVfsWithRetry(healthy.sqlite3, {
      stepHangTimeoutMs: 1_000,
      totalBudgetMs: 10_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
    }),
  ).resolves.toBe(poolUtil);
  expect(healthy.attempts()).toBe(1);

  // Transient throw: still retried in place and succeeds — a throw is not a hang.
  let remainingFailures = 2;
  const throwing = fakeSqlite3WithInstall(async () => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      throw accessHandleContentionError();
    }
    return poolUtil;
  });
  await expect(
    installSahPoolVfsWithRetry(throwing.sqlite3, {
      stepHangTimeoutMs: 1_000,
      totalBudgetMs: 10_000,
      initialDelayMs: 1,
      maxDelayMs: 1,
    }),
  ).resolves.toBe(poolUtil);
  expect(throwing.attempts()).toBe(3);
});
