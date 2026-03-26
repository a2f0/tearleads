declare module "@tearleads/sqlite-instance/jswasm/sqlite3.mjs" {
  import type { Sqlite3Static } from "@tearleads/sqlite-instance";
  const sqlite3InitModule: () => Promise<Sqlite3Static>;
  export default sqlite3InitModule;
}
