import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import sqlite3InitModule from "@tearleads/sqlite-instance/jswasm/sqlite3.mjs";
import type {
  DatabaseWorkerExecOptions,
  DatabaseWorkerInitOptions,
  SqliteBindValue,
} from "./types";

let sqlite3: Sqlite3Static | undefined;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;
let sqliteInitQueue = Promise.resolve();

function getBunFetch(): typeof fetch | null {
  return typeof Bun === "undefined" ? null : Bun.fetch;
}

function runWithBunFetchLock<T>(operation: () => Promise<T>): Promise<T> {
  const bunFetch = getBunFetch();
  if (!bunFetch) {
    return operation();
  }

  const nextOperation = sqliteInitQueue.then(async () => {
    const previousFetch = globalThis.fetch;
    // The generated SQLite/Emscripten loader calls bare fetch() while loading
    // sqlite3.wasm. In Bun, temporarily routing that global fetch call through
    // Bun.fetch keeps WASM loading compatible without patching generated files.
    globalThis.fetch = bunFetch;

    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  sqliteInitQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

export async function loadSqlite3(): Promise<Sqlite3Static> {
  if (sqlite3) {
    return sqlite3;
  }

  if (!sqlite3Promise) {
    sqlite3Promise = runWithBunFetchLock(async () => {
      const instance = await sqlite3InitModule();
      sqlite3 = instance;
      return instance;
    });
  }

  return sqlite3Promise;
}

export async function initDatabase(
  options: DatabaseWorkerInitOptions,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  const s = await loadSqlite3();

  return runWithBunFetchLock(async () => {
    const db = new s.oo1.DB(options.dbName);
    db.exec(`PRAGMA cipher='${options.cipher}'`);
    db.exec(`PRAGMA key='${options.key}'`);
    return db;
  });
}

export function execDatabaseStatement(
  db: InstanceType<Sqlite3Static["oo1"]["DB"]>,
  options: DatabaseWorkerExecOptions,
): Record<string, SqliteBindValue>[] {
  const rows: Record<string, SqliteBindValue>[] = [];

  db.exec(options.sql, {
    ...(options.bind ? { bind: options.bind } : {}),
    rowMode: "object",
    resultRows: rows,
  });

  return rows;
}
