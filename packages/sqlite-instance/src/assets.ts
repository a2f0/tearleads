export function getSqliteWasmAssetUrl(): URL {
  return new URL("../dist/jswasm/sqlite3.wasm", import.meta.url);
}
