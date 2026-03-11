import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MlsWasmPrimitiveBindings } from './mlsWasmBackend.js';
import * as mlsWasmBackend from './mlsWasmBackend.js';

type WasmGenerateCredential =
  typeof import('./mlsWasmBridge').wasmGenerateCredential;
type WasmGenerateKeyPackage =
  typeof import('./mlsWasmBridge').wasmGenerateKeyPackage;

let wasmGenerateCredential: WasmGenerateCredential;
let wasmGenerateKeyPackage: WasmGenerateKeyPackage;

function createPrimitiveBindings(
  overrides: Partial<MlsWasmPrimitiveBindings> = {}
): MlsWasmPrimitiveBindings {
  return {
    mls_backend_name: () => 'mock-mls',
    mls_backend_version: () => '0.0.0-test',
    mls_backend_ready: () => true,
    mls_backend_notice: () => 'ready',
    mls_generate_credential: () => ({
      credential_bundle: [1],
      private_key: [2],
      created_at_ms: 1
    }),
    mls_generate_key_package: () => ({
      key_package: [1],
      key_package_ref: 'mock-ref',
      private_key: [2],
      created_at_ms: 1
    }),
    mls_create_group: () => Uint8Array.from([]),
    mls_join_group: () => Uint8Array.from([]),
    mls_add_member: () => ({
      state: Uint8Array.from([]),
      commit: Uint8Array.from([]),
      welcome: Uint8Array.from([]),
      group_info: Uint8Array.from([]),
      new_epoch: 1
    }),
    mls_remove_member: () => ({
      state: Uint8Array.from([]),
      commit: Uint8Array.from([]),
      new_epoch: 1
    }),
    mls_process_commit: () => Uint8Array.from([]),
    mls_encrypt_message: () => Uint8Array.from([]),
    mls_decrypt_message: () => ({
      sender_id: 'mock-user',
      plaintext: Uint8Array.from([]),
      authenticated_data: Uint8Array.from([])
    }),
    mls_group_state_metadata: () => ({
      group_id: 'mock-group',
      epoch: 1,
      self_user_id: 'mock-user',
      members: []
    }),
    mls_export_group_state: () => Uint8Array.from([]),
    mls_import_group_state: () => ({
      state: Uint8Array.from([]),
      epoch: 1
    }),
    ...overrides
  };
}

describe('mlsWasmBridge', () => {
  beforeAll(async () => {
    const module = await import('./mlsWasmBridge');
    wasmGenerateCredential = module.wasmGenerateCredential;
    wasmGenerateKeyPackage = module.wasmGenerateKeyPackage;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('baselines generated credential shape from array-backed byte fields', async () => {
    vi.spyOn(mlsWasmBackend, 'loadMlsWasmPrimitiveBindings').mockResolvedValue(
      createPrimitiveBindings({
        mls_generate_credential: () => ({
          credential_bundle: [123, 34, 118, 101],
          private_key: [5, 10, 255],
          created_at_ms: 1234
        })
      })
    );

    const output = await wasmGenerateCredential('baseline-shape-user');

    expect(output.credentialBundle).toBeInstanceOf(Uint8Array);
    expect(output.privateKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.credentialBundle)).toEqual([123, 34, 118, 101]);
    expect(Array.from(output.privateKey)).toEqual([5, 10, 255]);
    expect(output.createdAtMs).toBe(1234);
  });

  it('normalizes generated key package byte fields from array buffers and views', async () => {
    vi.spyOn(mlsWasmBackend, 'loadMlsWasmPrimitiveBindings').mockResolvedValue(
      createPrimitiveBindings({
        mls_generate_key_package: () => ({
          key_package: Uint8Array.from([1, 2, 3]).buffer,
          key_package_ref: 'kp-ref',
          private_key: new Uint8ClampedArray([4, 5, 6]),
          created_at_ms: 5678
        })
      })
    );

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
    vi.spyOn(mlsWasmBackend, 'loadMlsWasmPrimitiveBindings').mockResolvedValue(
      createPrimitiveBindings({
        mls_generate_credential: () => ({
          credential_bundle: [1, -1],
          private_key: [2],
          created_at_ms: 1234
        })
      })
    );

    await expect(wasmGenerateCredential('alice')).rejects.toThrow(
      "WASM response field 'credential_bundle' array entries must be integers between 0 and 255"
    );
  });
});
