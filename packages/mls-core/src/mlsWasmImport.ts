const MLS_WASM_MODULE_PATH =
  '../.generated/mlsCoreWasm/tearleads_mls_core_wasm.js';

export async function importMlsWasmModule(): Promise<unknown> {
  return import(/* @vite-ignore */ MLS_WASM_MODULE_PATH);
}
