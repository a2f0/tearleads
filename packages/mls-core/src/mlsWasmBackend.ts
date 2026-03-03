import { importMlsWasmModule } from './mlsWasmImport.js';

interface MlsWasmBackendBindings {
  default?: () => Promise<unknown>;
  mls_backend_name: () => string;
  mls_backend_version: () => string;
  mls_backend_ready: () => boolean;
  mls_backend_notice: () => string;
}

export interface MlsWasmPrimitiveBindings extends MlsWasmBackendBindings {
  mls_generate_credential: (userId: string) => unknown;
  mls_generate_key_package: (
    credentialBundle: Uint8Array,
    credentialPrivateKey: Uint8Array
  ) => unknown;
  mls_create_group: (
    groupId: string,
    credentialBundle: Uint8Array,
    credentialPrivateKey: Uint8Array
  ) => Uint8Array;
  mls_join_group: (
    groupId: string,
    welcomeBytes: Uint8Array,
    keyPackageRef: string,
    keyPackagePrivateKey: Uint8Array,
    credentialBundle: Uint8Array,
    credentialPrivateKey: Uint8Array
  ) => Uint8Array;
  mls_add_member: (
    groupState: Uint8Array,
    memberKeyPackage: Uint8Array
  ) => unknown;
  mls_remove_member: (groupState: Uint8Array, leafIndex: number) => unknown;
  mls_process_commit: (
    groupState: Uint8Array,
    commitBytes: Uint8Array
  ) => Uint8Array;
  mls_encrypt_message: (
    groupState: Uint8Array,
    plaintext: Uint8Array
  ) => Uint8Array;
  mls_decrypt_message: (
    groupState: Uint8Array,
    ciphertext: Uint8Array
  ) => unknown;
  mls_group_state_metadata: (groupState: Uint8Array) => unknown;
  mls_export_group_state: (groupState: Uint8Array) => Uint8Array;
  mls_import_group_state: (groupId: string, groupState: Uint8Array) => unknown;
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
  reason: 'Rust/WASM MLS backend not loaded.'
};

let wasmModulePromise: Promise<unknown> | null = null;

function assertFunctions(
  module: unknown,
  functionNames: readonly string[]
): asserts module is Record<string, unknown> {
  if (typeof module !== 'object' || module === null) {
    throw new Error('WASM module is not an object. Run: pnpm codegenWasm');
  }

  for (const functionName of functionNames) {
    const candidate = Reflect.get(module, functionName);
    if (typeof candidate !== 'function') {
      throw new Error(
        `WASM module is missing function '${functionName}'. Run: pnpm codegenWasm`
      );
    }
  }
}

function assertBackendBindings(
  module: unknown
): asserts module is MlsWasmBackendBindings {
  assertFunctions(module, [
    'mls_backend_name',
    'mls_backend_version',
    'mls_backend_ready',
    'mls_backend_notice'
  ]);
}

function assertPrimitiveBindings(
  module: unknown
): asserts module is MlsWasmPrimitiveBindings {
  assertBackendBindings(module);
  assertFunctions(module, [
    'mls_generate_credential',
    'mls_generate_key_package',
    'mls_create_group',
    'mls_join_group',
    'mls_add_member',
    'mls_remove_member',
    'mls_process_commit',
    'mls_encrypt_message',
    'mls_decrypt_message',
    'mls_group_state_metadata',
    'mls_export_group_state',
    'mls_import_group_state'
  ]);
}

async function loadWasmModule(): Promise<unknown> {
  if (wasmModulePromise) {
    return wasmModulePromise;
  }

  wasmModulePromise = importMlsWasmModule().then(async (module) => {
    if (typeof module === 'object' && module !== null) {
      const defaultInit = Reflect.get(module, 'default');
      if (typeof defaultInit === 'function') {
        await defaultInit();
      }
    }
    return module;
  });

  return wasmModulePromise;
}

async function getBackendBindings(): Promise<MlsWasmBackendBindings> {
  const module = await loadWasmModule();
  assertBackendBindings(module);
  return module;
}

export async function loadMlsWasmPrimitiveBindings(): Promise<MlsWasmPrimitiveBindings> {
  const module = await loadWasmModule();
  assertPrimitiveBindings(module);
  return module;
}

export async function resolveMlsBackendStatus(): Promise<MlsBackendStatus> {
  try {
    const bindings = await getBackendBindings();
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
