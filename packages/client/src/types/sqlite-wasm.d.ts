/**
 * Type declaration for SQLite3MultipleCiphers WASM module.
 * The actual module is downloaded at build time by scripts/downloadSqliteWasm.sh
 */

declare module '@/workers/sqlite-wasm/sqlite3.js' {
  const sqlite3InitModule: (options: {
    print: typeof console.log;
    printErr: typeof console.error;
    locateFile?: (path: string, prefix: string) => string;
  }) => Promise<unknown>;

  export default sqlite3InitModule;
}
