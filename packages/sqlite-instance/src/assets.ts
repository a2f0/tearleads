export function getSqliteWasmAssetUrl(): URL {
  return new URL("../dist/jswasm/sqlite3.wasm", import.meta.url);
}

/** The licenses that travel with the SQLite WebAssembly. */
export function getSqliteLicensesUrl(): URL {
  return new URL("../LICENSES.md", import.meta.url);
}
