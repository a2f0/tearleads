import type {
  VfsRegisterResponse,
  VfsUserKeysResponse
} from '@tearleads/shared';
import {
  combinePublicKey,
  extractPublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVfsItemWithOnboarding } from './registrationClient';

vi.mock('./onboardingClient', () => ({
  ensureVfsOnboardingKeys: vi.fn()
}));

import { ensureVfsOnboardingKeys } from './onboardingClient';

function createServerKeys(): VfsUserKeysResponse {
  const publicEncryptionKey = combinePublicKey(
    serializePublicKey(extractPublicKey(generateKeyPair()))
  );
  return {
    publicEncryptionKey,
    publicSigningKey: 'sign',
    encryptedPrivateKeys: 'encrypted-private-keys',
    argon2Salt: 'argon2-salt'
  };
}

describe('vfs registration client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers using wrapped session key and returns createdKeys', async () => {
    const serverKeys = createServerKeys();
    const publicParts = serverKeys.publicEncryptionKey.split('.');
    vi.mocked(ensureVfsOnboardingKeys).mockResolvedValueOnce({
      created: true,
      publicKey: {
        x25519PublicKey: publicParts[0] ?? '',
        mlKemPublicKey: publicParts[1] ?? ''
      },
      serverKeys
    });
    const registerResponse: VfsRegisterResponse = {
      id: 'item-1',
      createdAt: '2026-02-19T00:00:00.000Z'
    };
    const apiClient = {
      getMyKeys: vi.fn(async () => serverKeys),
      setupKeys: vi.fn(async () => ({ created: true })),
      register: vi.fn(async () => registerResponse)
    };
    const sessionKey = new Uint8Array(32);
    sessionKey.fill(4);

    const result = await registerVfsItemWithOnboarding({
      password: 'password',
      id: 'item-1',
      objectType: 'file',
      apiClient,
      sessionKey
    });

    expect(result.createdKeys).toBe(true);
    expect(result.registerResponse).toEqual(registerResponse);
    expect(result.sessionKey).toEqual(sessionKey);
    expect(apiClient.register).toHaveBeenCalledTimes(1);
    const registerCall = apiClient.register.mock.calls[0]?.[0];
    expect(registerCall?.id).toBe('item-1');
    expect(registerCall?.objectType).toBe('file');
    expect(registerCall?.encryptedSessionKey).toMatch(/\./);
  });

  it('generates a new session key when one is not provided', async () => {
    const serverKeys = createServerKeys();
    const publicParts = serverKeys.publicEncryptionKey.split('.');
    vi.mocked(ensureVfsOnboardingKeys).mockResolvedValueOnce({
      created: false,
      publicKey: {
        x25519PublicKey: publicParts[0] ?? '',
        mlKemPublicKey: publicParts[1] ?? ''
      },
      serverKeys
    });
    const registerResponse: VfsRegisterResponse = {
      id: 'item-2',
      createdAt: '2026-02-20T00:00:00.000Z'
    };
    const apiClient = {
      getMyKeys: vi.fn(async () => serverKeys),
      setupKeys: vi.fn(async () => ({ created: false })),
      register: vi.fn(async () => registerResponse)
    };

    const result = await registerVfsItemWithOnboarding({
      password: 'password',
      id: 'item-2',
      objectType: 'folder',
      apiClient
    });

    expect(result.createdKeys).toBe(false);
    expect(result.registerResponse).toEqual(registerResponse);
    expect(result.sessionKey).toHaveLength(32);
    expect(apiClient.register).toHaveBeenCalledTimes(1);
    const registerCall = apiClient.register.mock.calls[0]?.[0];
    expect(registerCall?.id).toBe('item-2');
    expect(registerCall?.objectType).toBe('folder');
    expect(registerCall?.encryptedSessionKey).toMatch(/\./);
  });
});
