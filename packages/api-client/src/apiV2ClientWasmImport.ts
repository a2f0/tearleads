const API_V2_CLIENT_WASM_MODULE_PATH =
  '../.generated/apiClientWasm/tearleads_api_client_wasm.js';
const GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY =
  '__tearleadsImportApiV2ClientWasmModule';

type ApiV2ClientWasmImporter = () => Promise<unknown>;

function resolveGlobalApiV2ClientWasmImporter(): ApiV2ClientWasmImporter | null {
  const candidate = Reflect.get(
    globalThis,
    GLOBAL_API_V2_CLIENT_WASM_IMPORTER_KEY
  );
  if (typeof candidate !== 'function') {
    return null;
  }
  return candidate;
}

export async function importApiV2ClientWasmModule(): Promise<unknown> {
  const globalImporter = resolveGlobalApiV2ClientWasmImporter();
  if (globalImporter) {
    return globalImporter();
  }
  return import(/* @vite-ignore */ API_V2_CLIENT_WASM_MODULE_PATH);
}
