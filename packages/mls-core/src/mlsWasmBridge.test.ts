import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mls_generate_credential as generatedMlsGenerateCredential,
  initSync as initMlsCoreWasmSync
} from '../.generated/mlsCoreWasm/tearleads_mls_core_wasm.js';

type WasmGenerateCredential =
  typeof import('./mlsWasmBridge').wasmGenerateCredential;
type WasmGenerateKeyPackage =
  typeof import('./mlsWasmBridge').wasmGenerateKeyPackage;

const loadMlsWasmPrimitiveBindingsMock =
  vi.fn<() => Promise<Record<string, unknown>>>();
vi.mock('./mlsWasmBackend.js', () => ({
  loadMlsWasmPrimitiveBindings: () => loadMlsWasmPrimitiveBindingsMock()
}));

let wasmGenerateCredential: WasmGenerateCredential;
let wasmGenerateKeyPackage: WasmGenerateKeyPackage;

describe('mlsWasmBridge', () => {
  beforeAll(async () => {
    initMlsCoreWasmSync({
      module: readFileSync(
        new URL(
          '../.generated/mlsCoreWasm/tearleads_mls_core_wasm_bg.wasm',
          import.meta.url
        )
      )
    });

    const module = await import('./mlsWasmBridge');
    wasmGenerateCredential = module.wasmGenerateCredential;
    wasmGenerateKeyPackage = module.wasmGenerateKeyPackage;
  });

  beforeEach(() => {
    loadMlsWasmPrimitiveBindingsMock.mockReset();
  });

  it('baselines raw WASM credential output shape as array-backed bytes', () => {
    const raw = generatedMlsGenerateCredential('baseline-shape-user');

    expect(typeof raw).toBe('object');
    expect(raw).not.toBeNull();

    const record: Record<string, unknown> = raw;
    expect(Array.isArray(record.credential_bundle)).toBe(true);
    expect(Array.isArray(record.private_key)).toBe(true);
    expect(typeof record.created_at_ms).toBe('number');
  });

  it('normalizes real WASM credential output into Uint8Array fields', async () => {
    loadMlsWasmPrimitiveBindingsMock.mockResolvedValue({
      mls_generate_credential: generatedMlsGenerateCredential
    });

    const output = await wasmGenerateCredential('baseline-bridge-user');

    expect(output.credentialBundle).toBeInstanceOf(Uint8Array);
    expect(output.privateKey).toBeInstanceOf(Uint8Array);
    expect(output.credentialBundle.length).toBeGreaterThan(0);
    expect(output.privateKey.length).toBeGreaterThan(0);
  });

  it('normalizes generated credential byte arrays returned as number arrays', async () => {
    loadMlsWasmPrimitiveBindingsMock.mockResolvedValue({
      mls_generate_credential: () => ({
        credential_bundle: [123, 34, 118, 101],
        private_key: [5, 10, 255],
        created_at_ms: 1234
      })
    });

    const output = await wasmGenerateCredential('alice');

    expect(output.credentialBundle).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.credentialBundle)).toEqual([123, 34, 118, 101]);
    expect(output.privateKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.privateKey)).toEqual([5, 10, 255]);
    expect(output.createdAtMs).toBe(1234);
  });

  it('normalizes generated key package byte fields from array buffers and views', async () => {
    loadMlsWasmPrimitiveBindingsMock.mockResolvedValue({
      mls_generate_key_package: () => ({
        key_package: Uint8Array.from([1, 2, 3]).buffer,
        key_package_ref: 'kp-ref',
        private_key: new Uint8ClampedArray([4, 5, 6]),
        created_at_ms: 5678
      })
    });

    const output = await wasmGenerateKeyPackage(
      Uint8Array.from([9]),
      Uint8Array.from([8])
    );

    expect(output.keyPackage).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.keyPackage)).toEqual([1, 2, 3]);
    expect(output.privateKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.privateKey)).toEqual([4, 5, 6]);
    expect(output.keyPackageRef).toBe('kp-ref');
    expect(output.createdAtMs).toBe(5678);
  });

  it('rejects non-byte values in array-backed wasm responses', async () => {
    loadMlsWasmPrimitiveBindingsMock.mockResolvedValue({
      mls_generate_credential: () => ({
        credential_bundle: [1, -1],
        private_key: [2],
        created_at_ms: 1234
      })
    });

    await expect(wasmGenerateCredential('alice')).rejects.toThrow(
      "WASM response field 'credential_bundle' array entries must be integers between 0 and 255"
    );
  });
});
