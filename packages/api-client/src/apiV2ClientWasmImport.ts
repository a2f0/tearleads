const API_V2_CLIENT_WASM_MODULE_PATH =
  '../.generated/apiClientWasm/tearleads_api_client_wasm.js';

export async function importApiV2ClientWasmModule(): Promise<unknown> {
  return import(/* @vite-ignore */ API_V2_CLIENT_WASM_MODULE_PATH);
}
