import { isRecord, type PingData } from '@tearleads/shared';
import { importPingWasmModule } from './pingWasmImport';

const V2_PING_ENDPOINT = '/v2/ping';

interface PingWasmBindings {
  default?: () => Promise<unknown>;
  parse_v2_ping_value: (payload: unknown) => PingData;
  v2_ping_path: () => string;
}

let pingWasmBindingsPromise: Promise<PingWasmBindings | null> | null = null;

function assertPingWasmBindings(
  module: unknown
): asserts module is PingWasmBindings {
  if (
    !isRecord(module) ||
    typeof module['parse_v2_ping_value'] !== 'function' ||
    typeof module['v2_ping_path'] !== 'function'
  ) {
    throw new Error(
      'WASM module does not export expected ping bindings. Run: pnpm codegenWasm'
    );
  }
}

function isMissingWasmModuleError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (error['code'] === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }

  return (
    typeof error['message'] === 'string' &&
    error['message'].includes('Cannot find module')
  );
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

async function loadPingWasmBindings(): Promise<PingWasmBindings | null> {
  if (pingWasmBindingsPromise) {
    return pingWasmBindingsPromise;
  }

  pingWasmBindingsPromise = (async () => {
    try {
      const module: unknown = await importPingWasmModule();
      assertPingWasmBindings(module);
      if (module.default) {
        await module.default();
      }
      return module;
    } catch (error) {
      if (isMissingWasmModuleError(error)) {
        return null;
      }
      throw error;
    }
  })();

  return pingWasmBindingsPromise;
}

export async function getV2PingEndpoint(): Promise<string> {
  const bindings = await loadPingWasmBindings();
  if (!bindings) {
    return V2_PING_ENDPOINT;
  }
  return bindings.v2_ping_path();
}

export async function parseV2PingData(payload: unknown): Promise<PingData> {
  const bindings = await loadPingWasmBindings();
  if (!bindings) {
    if (!isPingData(payload)) {
      throw new Error('Invalid v2 ping response payload');
    }
    return payload;
  }
  return bindings.parse_v2_ping_value(payload);
}
