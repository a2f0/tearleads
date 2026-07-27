// Drives the REAL SQLite OPFS-SAHPool VFS + SQLite3MultipleCiphers (chacha20)
// codec — through the production install path in loadSqlite3.ts — against an
// in-memory OPFS, to pin down what does (and does not) cause the
// `SQLITE_NOTADB: ... file is not a database` error seen in the app.
//
// Findings these tests encode:
//   - Encrypted data survives a close/reopen with the SAME key (sanity).
//   - Reopening with a DIFFERENT key yields exactly SQLITE_NOTADB. This is the
//     reported failure: a wrong/rotated cipher key over a still-persisted file,
//     NOT an unclean mount.
//   - An unclean worker termination (modeled as a crash at any xSync/flush
//     barrier under synchronous=FULL) never yields SQLITE_NOTADB — the rollback
//     journal recovers every cut.
//   - Two workers cannot install a pool over the same OPFS directory: the second
//     loses the access-handle exclusivity race (contention), it does not corrupt.
import { afterEach, expect, test } from "bun:test";
import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import {
  closeDatabase,
  deleteDatabase,
  initDatabase,
  installSahPoolVfsWithRetry,
  loadSqlite3,
  persistentSahPoolStorageForDbName,
} from "../src/loadSqlite3";
import {
  installOpfsMemoryShim,
  mountOpfsSnapshot,
  type OpfsTreeSnapshot,
  opfsInstrumentation,
  snapshotOpfsTree,
  uninstallOpfsMemoryShim,
} from "./opfsMemoryShim";

// Restore the globals the in-memory OPFS shim replaced so it never leaks into
// other suites (Bun runs every test file in one shared process).
afterEach(() => {
  opfsInstrumentation.onFlush = null;
  uninstallOpfsMemoryShim();
});

type SahPoolUtil = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;
type Database = InstanceType<Sqlite3Static["oo1"]["DB"]>;

interface EncryptedPool {
  readonly poolUtil: SahPoolUtil;
  readonly cipherVfsName: string;
}

// Wrap an already-installed SAHPool with the SQLite3MultipleCiphers codec VFS so
// `PRAGMA key=` works. Idempotent: a single wasm instance keeps its VFS registry
// across reopens, so reuse the wrapper if it already exists (a fresh browser
// worker would always start clean). Mirrors createCipherVfs in loadSqlite3.ts.
function ensureCipherVfs(s: Sqlite3Static, underlyingVfsName: string): string {
  const existing = s.capi
    .sqlite3_js_vfs_list()
    .find(
      (name) => name !== underlyingVfsName && name.includes(underlyingVfsName),
    );
  if (existing) {
    return existing;
  }

  const create = Reflect.get(s.capi, "sqlite3mc_vfs_create");
  if (typeof create !== "function") {
    throw new Error("This SQLite build does not provide sqlite3mc_vfs_create.");
  }
  const before = new Set(s.capi.sqlite3_js_vfs_list());
  const rc: unknown = Reflect.apply(create, s.capi, [underlyingVfsName, 0]);
  if (typeof rc !== "number" || rc !== 0) {
    throw new Error(`sqlite3mc_vfs_create failed (rc=${String(rc)}).`);
  }
  const created = s.capi
    .sqlite3_js_vfs_list()
    .filter((name) => !before.has(name));
  const cipherVfsName =
    created.find((name) => name.includes(underlyingVfsName)) ?? created[0];
  if (!cipherVfsName) {
    throw new Error("The multiple-ciphers VFS could not be located.");
  }
  return cipherVfsName;
}

// Install (or, on reopen within this process, re-acquire) the production
// per-db SAHPool stack for a database name. Uses the real install + naming.
async function installEncryptedPool(
  s: Sqlite3Static,
  dbName: string,
  vfsNameOverride?: string,
): Promise<EncryptedPool> {
  const storage = persistentSahPoolStorageForDbName(dbName);
  const poolUtil = await installSahPoolVfsWithRetry(s, {
    directory: storage.directory,
    vfsName: vfsNameOverride ?? storage.vfsName,
  });
  // A reopen within the same process re-acquires the released OPFS handles,
  // re-reading file headers from disk == a fresh boot reading persisted bytes.
  if (poolUtil.isPaused()) {
    await poolUtil.unpauseVfs();
  }
  await poolUtil.reserveMinimumCapacity(12);
  return { poolUtil, cipherVfsName: ensureCipherVfs(s, poolUtil.vfsName) };
}

function openEncrypted(
  s: Sqlite3Static,
  pool: EncryptedPool,
  dbName: string,
  key: string,
): Database {
  const db = new s.oo1.DB(dbName, "c", pool.cipherVfsName);
  db.exec("PRAGMA cipher='chacha20'");
  db.exec(`PRAGMA key='${key}'`);
  return db;
}

// Graceful close: drop the connection, then pauseVfs() to release OPFS handles
// without wiping files, so the next open re-reads page 1 from disk.
function closeAndPause(db: Database | null, poolUtil: SahPoolUtil): void {
  try {
    db?.close();
  } catch {
    // already closing down
  }
  poolUtil.pauseVfs();
}

function isNotADbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SQLITE_NOTADB") ||
    message.includes("file is not a database")
  );
}

test("production lifecycle reopens a paused identity VFS", async () => {
  installOpfsMemoryShim();
  const dbName = `/identity-switch-${crypto.randomUUID()}.db`;
  const options = {
    cipher: "chacha20" as const,
    dbName,
    key: "identity-switch-key",
    persistence: "opfs-sahpool" as const,
  };

  let db: Database | null = await initDatabase(options);
  try {
    db.exec("CREATE TABLE marker(value TEXT)");
    db.exec("INSERT INTO marker VALUES ('identity-a')");
    await closeDatabase(db);
    db = null;

    // This is the A -> B -> A failure in its smallest form. Closing A pauses
    // its pool but leaves the cipher wrapper registered in this worker. Reopen
    // must unpause and reuse that wrapper instead of creating a duplicate.
    db = await initDatabase(options);
    expect(db.selectValue("SELECT value FROM marker")).toBe("identity-a");
  } finally {
    if (db) {
      await deleteDatabase(db);
    }
  }
});

test("deleting an identity removes its cipher wrapper before recreation", async () => {
  installOpfsMemoryShim();
  const dbName = `/identity-delete-${crypto.randomUUID()}.db`;
  const options = {
    cipher: "chacha20" as const,
    dbName,
    key: "identity-delete-key",
    persistence: "opfs-sahpool" as const,
  };

  let db: Database | null = await initDatabase(options);
  try {
    db.exec("CREATE TABLE removed(value TEXT)");
    await deleteDatabase(db);
    db = null;

    // Recreating an identity with the same stable database name must install a
    // fresh underlying pool and cipher wrapper, with no data from the deletion.
    db = await initDatabase(options);
    expect(
      db.selectValue(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='removed'",
      ),
    ).toBe(0);
  } finally {
    if (db) {
      await deleteDatabase(db);
    }
  }
});

test("encrypted data persists across a close/reopen with the same key", async () => {
  installOpfsMemoryShim();
  const s = await loadSqlite3();
  const dbName = "/app-identity-persist.db";

  let pool = await installEncryptedPool(s, dbName);
  let db = openEncrypted(s, pool, dbName, "correct-key");
  db.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)");
  db.exec("INSERT INTO notes(body) VALUES ('hello'),('world')");
  closeAndPause(db, pool.poolUtil);

  pool = await installEncryptedPool(s, dbName);
  db = openEncrypted(s, pool, dbName, "correct-key");
  const count = db.selectValue("SELECT count(*) FROM notes");
  const bodies: unknown[] = [];
  db.exec({
    sql: "SELECT body FROM notes ORDER BY id",
    rowMode: "array",
    callback: (row: unknown[]) => {
      bodies.push(row[0]);
    },
  });
  closeAndPause(db, pool.poolUtil);

  expect(count).toBe(2);
  expect(bodies).toEqual(["hello", "world"]);
});

test("reopening an encrypted database with the wrong key throws SQLITE_NOTADB", async () => {
  installOpfsMemoryShim();
  const s = await loadSqlite3();
  const dbName = "/app-identity-wrongkey.db";

  let pool = await installEncryptedPool(s, dbName);
  let db = openEncrypted(s, pool, dbName, "key-derived-from-root-A");
  db.exec("CREATE TABLE t(x); INSERT INTO t VALUES (1),(2)");
  closeAndPause(db, pool.poolUtil);

  // A new boot derives a different key (e.g. the keyring manifest was evicted and
  // a fresh root was minted) for the SAME persisted, still-encrypted file.
  pool = await installEncryptedPool(s, dbName);
  db = openEncrypted(s, pool, dbName, "key-derived-from-root-B");
  // The wrong key surfaces as NOTADB on the first read of page 1 (any query).
  let caught: unknown;
  try {
    db.selectValue("SELECT count(*) FROM t");
  } catch (error) {
    caught = error;
  }
  closeAndPause(db, pool.poolUtil);

  expect(caught).toBeDefined();
  expect(isNotADbError(caught)).toBe(true);
});

test("an unclean worker termination never corrupts page 1 into SQLITE_NOTADB", async () => {
  const root = installOpfsMemoryShim();
  const s = await loadSqlite3();
  const dbName = "/app-identity-crash.db";
  const key = "crash-test-key";

  // Snapshot the durable bytes at every flush barrier during a write workload.
  // Under synchronous=FULL a crash can only expose a state ending at some flush,
  // and worker terminate() lands between (never mid) synchronous writes.
  const barriers: OpfsTreeSnapshot[] = [];
  let recording = false;
  opfsInstrumentation.onFlush = () => {
    if (recording) {
      barriers.push(snapshotOpfsTree(root));
    }
  };

  const pool = await installEncryptedPool(s, dbName);
  const db = openEncrypted(s, pool, dbName, key);
  recording = true;
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, a TEXT, b BLOB)");
  for (let i = 0; i < 12; i += 1) {
    db.exec({
      sql: "INSERT INTO t(a, b) VALUES (?, ?)",
      bind: [`row-${i}`, new Uint8Array(128).fill(i & 0xff)],
    });
  }
  db.exec("BEGIN");
  for (let i = 0; i < 12; i += 1) {
    db.exec({ sql: "UPDATE t SET a = a || '-x' WHERE id = ?", bind: [i + 1] });
  }
  db.exec("COMMIT");
  db.exec("DELETE FROM t WHERE id % 2 = 0");
  recording = false;
  closeAndPause(db, pool.poolUtil);
  opfsInstrumentation.onFlush = null;

  expect(barriers.length).toBeGreaterThan(5);

  // Boot a fresh "worker" from each barrier state with the CORRECT key. Every cut
  // must reopen consistently — no SQLITE_NOTADB, no malformed image.
  let probeIndex = 0;
  for (const snapshot of barriers) {
    probeIndex += 1;
    mountOpfsSnapshot(snapshot);
    const probePool = await installEncryptedPool(
      s,
      dbName,
      `crash-probe-${probeIndex}`,
    );
    let probeDb: Database | null = null;
    let integrity: unknown;
    let notADb = false;
    try {
      probeDb = openEncrypted(s, probePool, dbName, key);
      integrity = probeDb.selectValue("PRAGMA integrity_check");
      probeDb.selectValue("SELECT count(*) FROM sqlite_master");
    } catch (error) {
      notADb = isNotADbError(error);
      integrity = error instanceof Error ? error.message : String(error);
    } finally {
      closeAndPause(probeDb, probePool.poolUtil);
    }

    expect(notADb).toBe(false);
    expect(integrity).toBe("ok");
  }
}, 20_000);

test("a second worker cannot install a pool over a directory whose handles are held", async () => {
  installOpfsMemoryShim();
  const s = await loadSqlite3();
  const dbName = "/app-identity-contended.db";

  // Worker 1 holds the pool's OPFS access handles (db kept open).
  const pool = await installEncryptedPool(s, dbName);
  const db = openEncrypted(s, pool, dbName, "k");
  db.exec("CREATE TABLE t(x); INSERT INTO t VALUES (1)");

  // Worker 2 tries to install over the SAME directory. OPFS gives each pool file
  // an exclusive sync access handle, so the second install fails with the
  // lock-contention error rather than silently sharing and corrupting.
  let contention = false;
  try {
    await installSahPoolVfsWithRetry(s, {
      directory: persistentSahPoolStorageForDbName(dbName).directory,
      vfsName: "second-worker-pool",
      totalBudgetMs: 0,
    });
  } catch (error) {
    contention =
      error instanceof Error &&
      (error.name === "NoModificationAllowedError" ||
        error.message.includes("Access Handles cannot be created"));
  }
  closeAndPause(db, pool.poolUtil);

  expect(contention).toBe(true);
});
