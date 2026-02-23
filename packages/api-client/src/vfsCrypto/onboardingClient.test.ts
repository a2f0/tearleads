import type { VfsUserKeysResponse } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureVfsOnboardingKeys,
  loadVfsKeyPairFromServer
} from './onboardingClient';

vi.mock('./keyOnboarding', () => ({
  createVfsOnboardingKeyBundle: vi.fn(async () => ({
    keyPair: {
      x25519PublicKey: new Uint8Array(32),
      x25519PrivateKey: new Uint8Array(32),
      mlKemPublicKey: new Uint8Array(1184),
      mlKemPrivateKey: new Uint8Array(2400)
    },
    setupPayload: {
      publicEncryptionKey: 'x25519.mlkem',
      publicSigningKey: '',
      encryptedPrivateKeys: 'encrypted-keys',
      argon2Salt: 'salt'
    }
  })),
  decryptVfsPrivateKeyBundle: vi.fn(async () => ({
    x25519PublicKey: new Uint8Array(32),
    x25519PrivateKey: new Uint8Array(32),
    mlKemPublicKey: new Uint8Array(1184),
    mlKemPrivateKey: new Uint8Array(2400)
  }))
}));

function createServerKeys(): VfsUserKeysResponse {
  return {
    publicEncryptionKey: 'x25519.mlkem',
    publicSigningKey: 'signing-key',
    encryptedPrivateKeys: 'encrypted-keys',
    argon2Salt: 'salt'
  };
}

describe('vfs onboarding client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing keys when already present', async () => {
    const serverKeys = createServerKeys();
    const apiClient = {
      getMyKeys: vi.fn(async () => serverKeys),
      setupKeys: vi.fn(async () => ({ created: true }))
    };

    const result = await ensureVfsOnboardingKeys({
      password: 'password',
      apiClient
    });

    expect(result.created).toBe(false);
    expect(result.serverKeys).toEqual(serverKeys);
    expect(result.publicKey).toEqual({
      x25519PublicKey: 'x25519',
      mlKemPublicKey: 'mlkem'
    });
    expect(apiClient.setupKeys).not.toHaveBeenCalled();
  });

  it('creates keys when getMyKeys returns 404', async () => {
    const serverKeys = createServerKeys();
    const apiClient = {
      getMyKeys: vi
        .fn<() => Promise<VfsUserKeysResponse>>()
        .mockRejectedValueOnce(new Error('404'))
        .mockResolvedValueOnce(serverKeys),
      setupKeys: vi.fn(async () => ({ created: true }))
    };

    const result = await ensureVfsOnboardingKeys({
      password: 'password',
      apiClient
    });

    expect(result.created).toBe(true);
    expect(apiClient.setupKeys).toHaveBeenCalledTimes(1);
    expect(apiClient.getMyKeys).toHaveBeenCalledTimes(2);
  });

  it('creates keys when server says keys are not set up', async () => {
    const serverKeys = createServerKeys();
    const apiClient = {
      getMyKeys: vi
        .fn<() => Promise<VfsUserKeysResponse>>()
        .mockRejectedValueOnce(new Error('VFS keys not set up'))
        .mockResolvedValueOnce(serverKeys),
      setupKeys: vi.fn(async () => ({ created: true }))
    };

    const result = await ensureVfsOnboardingKeys({
      password: 'password',
      apiClient
    });

    expect(result.created).toBe(true);
    expect(apiClient.setupKeys).toHaveBeenCalledTimes(1);
    expect(apiClient.getMyKeys).toHaveBeenCalledTimes(2);
  });

  it('throws if password is empty', async () => {
    const apiClient = {
      getMyKeys: vi.fn(async () => createServerKeys()),
      setupKeys: vi.fn(async () => ({ created: true }))
    };

    await expect(
      ensureVfsOnboardingKeys({ password: '   ', apiClient })
    ).rejects.toThrow(/password is required/);
  });

  it('loads a decryptable keypair from server keys', async () => {
    const keyPair = await loadVfsKeyPairFromServer({
      password: 'password',
      serverKeys: createServerKeys()
    });

    expect(keyPair.x25519PrivateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.mlKemPrivateKey).toBeInstanceOf(Uint8Array);
  });

  it('throws when encrypted private keys are missing', async () => {
    await expect(
      loadVfsKeyPairFromServer({
        password: 'password',
        serverKeys: {
          publicEncryptionKey: 'x25519.mlkem',
          publicSigningKey: 'signing-key'
        }
      })
    ).rejects.toThrow(/encrypted private keys are not available/);
  });
});
