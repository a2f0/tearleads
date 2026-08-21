/**
 * SQLite3 Multiple Ciphers WASM instance.
 *
 * This package provides the pre-built SQLite3MultipleCiphers WASM binary
 * and JavaScript bindings. Run `bun run build` to download the release
 * artifacts into dist/jswasm/.
 *
 * Usage from a worker thread:
 *
 *   import sqlite3InitModule from "@symcrypt/sqlite-instance/jswasm/sqlite3.mjs";
 *
 *   const sqlite3 = await sqlite3InitModule();
 */

export const SQLITE3MC_VERSION = "2.3.2";
export const SQLITE_VERSION = "3.51.3";

export type {
  Database,
  PreparedStatement,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
