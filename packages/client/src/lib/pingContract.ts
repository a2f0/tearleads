import { isRecord, type PingData } from '@tearleads/shared';
import { importPingWasmModule } from './pingWasmImport';

interface PingWasmBindings {
  default?: () => Promise<unknown>;
  parse_v2_ping_value: (payload: unknown) => PingData;
  v2_ping_path: () => string;
}

let pingWasmBindingsPromise: Promise<PingWasmBindings> | null = null;

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

async function loadPingWasmBindings(): Promise<PingWasmBindings> {
  if (pingWasmBindingsPromise) {
    return pingWasmBindingsPromise;
  }

  pingWasmBindingsPromise = importPingWasmModule().then(
    async (module: unknown) => {
      assertPingWasmBindings(module);
      if (module.default) {
        await module.default();
      }
      return module;
    }
  );

  return pingWasmBindingsPromise;
}

export async function getV2PingEndpoint(): Promise<string> {
  const bindings = await loadPingWasmBindings();
  return bindings.v2_ping_path();
}

export async function parseV2PingData(payload: unknown): Promise<PingData> {
  const bindings = await loadPingWasmBindings();
  return bindings.parse_v2_ping_value(payload);
}
