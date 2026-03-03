import { isRecord, type PingData } from '@tearleads/shared';

const V2_PING_ENDPOINT = '/v2/ping';
const PING_WASM_MODULE_PATH =
  '../.generated/apiV2PingWasm/tearleads_api_v2_ping_wasm.js';

interface PingWasmBindings {
  default?: () => Promise<unknown>;
  parse_v2_ping_value: (payload: unknown) => unknown;
  v2_ping_path: () => string;
}

let pingWasmBindingsPromise: Promise<PingWasmBindings | null> | null = null;

function isPingWasmBindings(value: unknown): value is PingWasmBindings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['parse_v2_ping_value'] === 'function' &&
    typeof value['v2_ping_path'] === 'function'
  );
}

async function loadPingWasmBindings(): Promise<PingWasmBindings | null> {
  if (pingWasmBindingsPromise) {
    return pingWasmBindingsPromise;
  }

  pingWasmBindingsPromise = import(/* @vite-ignore */ PING_WASM_MODULE_PATH)
    .then(async (module: unknown) => {
      if (!isPingWasmBindings(module)) {
        return null;
      }
      if (module.default) {
        await module.default();
      }
      return module;
    })
    .catch(() => null);

  return pingWasmBindingsPromise;
}

function isPingData(value: unknown): value is PingData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value['status'] === 'ok' &&
    value['service'] === 'api-v2' &&
    typeof value['version'] === 'string' &&
    value['version'].trim().length > 0
  );
}

export async function getV2PingEndpoint(): Promise<string> {
  const bindings = await loadPingWasmBindings();
  if (!bindings) {
    return V2_PING_ENDPOINT;
  }

  try {
    const path = bindings.v2_ping_path();
    if (path === V2_PING_ENDPOINT) {
      return path;
    }
  } catch {
    // Ignore wasm lookup errors and fall back to static endpoint.
  }

  return V2_PING_ENDPOINT;
}

export async function parseV2PingData(payload: unknown): Promise<PingData> {
  const bindings = await loadPingWasmBindings();
  if (bindings) {
    try {
      const parsedPayload = bindings.parse_v2_ping_value(payload);
      if (isPingData(parsedPayload)) {
        return parsedPayload;
      }
    } catch {
      // Ignore wasm parse errors and fall back to TypeScript validation.
    }
  }

  if (!isPingData(payload)) {
    throw new Error('Invalid v2 ping response payload');
  }

  return payload;
}
