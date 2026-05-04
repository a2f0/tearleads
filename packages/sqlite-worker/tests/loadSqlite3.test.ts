import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
  loadSqlite3,
} from "../src/loadSqlite3";

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
