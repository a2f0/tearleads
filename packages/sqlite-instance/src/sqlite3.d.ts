import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";

declare module "@symcrypt/sqlite-instance/jswasm/sqlite3.mjs" {
  const sqlite3InitModule: () => Promise<Sqlite3Static>;
  export default sqlite3InitModule;
}
