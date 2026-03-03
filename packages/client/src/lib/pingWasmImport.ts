const PING_WASM_MODULE_PATH =
  '../../.generated/apiV2PingWasm/tearleads_api_v2_ping_wasm.js';

export async function importPingWasmModule(): Promise<unknown> {
  return import(/* @vite-ignore */ PING_WASM_MODULE_PATH);
}
