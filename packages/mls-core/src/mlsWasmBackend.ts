import { importMlsWasmModule } from './mlsWasmImport.js';

interface MlsWasmBindings {
  default?: () => Promise<unknown>;
  mls_backend_name: () => string;
  mls_backend_version: () => string;
  mls_backend_ready: () => boolean;
  mls_backend_notice: () => string;
}

export interface MlsBackendStatus {
  backend: 'wasm' | 'placeholder';
  wasmModuleLoaded: boolean;
  backendName: string;
  backendVersion: string | null;
  productionReady: boolean;
  reason: string;
}

const PLACEHOLDER_BACKEND_NAME = 'typescript-placeholder';

const PLACEHOLDER_STATUS: MlsBackendStatus = {
  backend: 'placeholder',
  wasmModuleLoaded: false,
  backendName: PLACEHOLDER_BACKEND_NAME,
  backendVersion: null,
  productionReady: false,
  reason: 'Rust/WASM MLS backend not loaded. Using placeholder TypeScript path.'
};

let mlsWasmBindingsPromise: Promise<MlsWasmBindings> | null = null;

function assertMlsWasmBindings(
  module: unknown
): asserts module is MlsWasmBindings {
  if (
    typeof module !== 'object' ||
    module === null ||
    typeof (module as Record<string, unknown>)['mls_backend_name'] !==
      'function' ||
    typeof (module as Record<string, unknown>)['mls_backend_version'] !==
      'function' ||
    typeof (module as Record<string, unknown>)['mls_backend_ready'] !==
      'function' ||
    typeof (module as Record<string, unknown>)['mls_backend_notice'] !==
      'function'
  ) {
    throw new Error(
      'WASM module does not export expected MLS bindings. Run: pnpm codegenWasm'
    );
  }
}

async function loadMlsWasmBindings(): Promise<MlsWasmBindings> {
  if (mlsWasmBindingsPromise) {
    return mlsWasmBindingsPromise;
  }

  mlsWasmBindingsPromise = importMlsWasmModule().then(async (module) => {
    assertMlsWasmBindings(module);
    if (module.default) {
      await module.default();
    }
    return module;
  });

  return mlsWasmBindingsPromise;
}

export async function resolveMlsBackendStatus(): Promise<MlsBackendStatus> {
  try {
    const bindings = await loadMlsWasmBindings();
    const productionReady = bindings.mls_backend_ready();

    return {
      backend: productionReady ? 'wasm' : 'placeholder',
      wasmModuleLoaded: true,
      backendName: bindings.mls_backend_name(),
      backendVersion: bindings.mls_backend_version(),
      productionReady,
      reason: productionReady
        ? 'Rust/WASM MLS backend is active.'
        : bindings.mls_backend_notice()
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown WASM backend error';

    return {
      ...PLACEHOLDER_STATUS,
      reason: `${PLACEHOLDER_STATUS.reason} (${message})`
    };
  }
}
