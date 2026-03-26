declare module "@tearleads/sqlite-instance/jswasm/sqlite3.mjs" {
  const sqlite3InitModule: () => Promise<
    import("@sqlite.org/sqlite-wasm").Sqlite3Static
  >;
  export default sqlite3InitModule;
}
