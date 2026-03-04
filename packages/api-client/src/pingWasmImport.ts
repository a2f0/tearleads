const PING_WASM_MODULE_PATH =
  '../.generated/apiV2PingWasm/tearleads_api_v2_ping_wasm.js';
const GLOBAL_PING_WASM_IMPORTER_KEY = '__tearleadsImportPingWasmModule';

type PingWasmImporter = () => Promise<unknown>;

function resolveGlobalPingWasmImporter(): PingWasmImporter | null {
  const candidate = Reflect.get(globalThis, GLOBAL_PING_WASM_IMPORTER_KEY);
  if (typeof candidate !== 'function') {
    return null;
  }
  return candidate;
}

export async function importPingWasmModule(): Promise<unknown> {
  const globalImporter = resolveGlobalPingWasmImporter();
  if (globalImporter) {
    return globalImporter();
  }
  return import(/* @vite-ignore */ PING_WASM_MODULE_PATH);
}
