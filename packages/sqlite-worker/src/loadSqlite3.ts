import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import sqlite3InitModule from "@tearleads/sqlite-instance/jswasm/sqlite3.mjs";
import type { DatabaseWorkerInitOptions } from "./types";

let sqlite3: Sqlite3Static | undefined;

export async function loadSqlite3(): Promise<Sqlite3Static> {
  if (sqlite3) {
    return sqlite3;
  }

  const instance = await sqlite3InitModule();
  sqlite3 = instance;
  return instance;
}

export async function initDatabase(
  options: DatabaseWorkerInitOptions,
): Promise<InstanceType<Sqlite3Static["oo1"]["DB"]>> {
  const s = await loadSqlite3();
  const db = new s.oo1.DB(options.dbName);
  db.exec(`PRAGMA cipher='${options.cipher}'`);
  db.exec(`PRAGMA key='${options.key}'`);
  return db;
}
