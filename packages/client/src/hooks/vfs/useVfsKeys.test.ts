import { decrypt } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVfsKeysCache,
  createVfsKeySetupPayloadForOnboarding,
  ensureVfsKeyPair,
  ensureVfsKeys,
  generateSessionKey,
  getVfsPublicKey,
  hasVfsKeys,
  registerVfsItemWithCurrentKeys,
  wrapSessionKey
} from './useVfsKeys';

// Mock @tearleads/shared crypto functions
vi.mock('@tearleads/shared', () => ({
  combineEncapsulation: vi.fn(
    (enc: { x25519: Uint8Array; mlKem: Uint8Array }) =>
      `combined:${enc.x25519.length}:${enc.mlKem.length}`
  ),
  buildVfsPublicEncryptionKey: vi.fn(() => 'combined-public-key'),
  combinePublicKey: vi.fn(() => 'combined-public-key'),
  decryptVfsPrivateKeysWithRawKey: vi.fn(async () => ({
    x25519PrivateKey: 'dGVzdA==',
    mlKemPrivateKey: 'dGVzdA=='
  })),
  deserializePublicKey: vi.fn(
    (_serialized: { x25519: string; mlKem: string }) => ({
      x25519PublicKey: new Uint8Array(32),
      mlKemPublicKey: new Uint8Array(800)
    })
  ),
  encryptVfsPrivateKeysWithRawKey: vi.fn(async () => ({
    encryptedPrivateKeys: 'ZW5jcnlwdGVk',
    argon2Salt: 'c2FsdA=='
  })),
  decrypt: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  encrypt: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  generateKeyPair: vi.fn(() => ({
    x25519PublicKey: new Uint8Array(32).fill(1),
    x25519PrivateKey: new Uint8Array(32).fill(2),
    mlKemPublicKey: new Uint8Array(800).fill(3),
    mlKemPrivateKey: new Uint8Array(2400).fill(4)
  })),
  generateSalt: vi.fn(() => new Uint8Array(16)),
  importKey: vi.fn(async () => ({}) as CryptoKey),
  serializeKeyPair: vi.fn((_kp: { x25519PublicKey: Uint8Array }) => ({
    x25519PublicKey: 'base64-x25519-pub',
    x25519PrivateKey: 'base64-x25519-priv',
    mlKemPublicKey: 'base64-mlkem-pub',
    mlKemPrivateKey: 'base64-mlkem-priv'
  })),
  splitPublicKey: vi.fn(() => ({
    x25519PublicKey: btoa(String.fromCharCode(...new Uint8Array(32))),
    mlKemPublicKey: btoa(String.fromCharCode(...new Uint8Array(800)))
  })),
  wrapKeyForRecipient: vi.fn(() => ({
    x25519: new Uint8Array(48),
    mlKem: new Uint8Array(1088)
  }))
}));

// Mock key manager
vi.mock('@/db/crypto/keyManager', () => ({
  getKeyManager: vi.fn()
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getMyKeys: vi.fn(),
      setupKeys: vi.fn(),
      register: vi.fn()
    }
  }
}));

import { getKeyManager } from '@/db/crypto/keyManager';
import { api } from '@/lib/api';

describe('useVfsKeys', () => {
  const mockKeyManager = {
    getCurrentKey: vi.fn<() => Uint8Array | null>(() =>
      new Uint8Array(32).fill(5)
    )
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearVfsKeysCache();
    vi.mocked(getKeyManager).mockReturnValue(
      mockKeyManager as unknown as ReturnType<typeof getKeyManager>
    );

    // Mock crypto.getRandomValues for generateSessionKey
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i % 256;
        }
        return arr;
      }
    });
  });

  describe('generateSessionKey', () => {
    it('generates a 32-byte random key', () => {
      const key = generateSessionKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });
  });

  describe('clearVfsKeysCache', () => {
    it('clears cached keypair', async () => {
      // First ensure keys are cached by calling ensureVfsKeys
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      await ensureVfsKeys();

      // Clear the cache
      clearVfsKeysCache();

      // Now getMyKeys should be called again (cache was cleared)
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      await ensureVfsKeys();

      expect(api.vfs.getMyKeys).toHaveBeenCalledTimes(2);
    });

    it('does nothing when cache is empty', () => {
      // Should not throw
      expect(() => clearVfsKeysCache()).not.toThrow();
    });
  });

  describe('hasVfsKeys', () => {
    it('returns true when keys exist on server', async () => {
      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'key',
        publicSigningKey: 'sign'
      });

      const result = await hasVfsKeys();
      expect(result).toBe(true);
    });

    it('returns false when keys do not exist (404)', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));

      const result = await hasVfsKeys();
      expect(result).toBe(false);
    });

    it('returns false when keys are not set up', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(
        new Error('VFS keys not set up')
      );

      const result = await hasVfsKeys();
      expect(result).toBe(false);
    });

    it('throws on other errors', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('500'));

      await expect(hasVfsKeys()).rejects.toThrow('500');
    });
  });

  describe('ensureVfsKeys', () => {
    it('returns cached keys if available', async () => {
      // First call - no keys on server, generate new
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      const keys1 = await ensureVfsKeys();

      // Second call should use cache (no API calls)
      const keys2 = await ensureVfsKeys();

      expect(keys1).toEqual(keys2);
      expect(api.vfs.getMyKeys).toHaveBeenCalledTimes(1);
    });

    it('fetches existing keys from server', async () => {
      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'existing-key',
        publicSigningKey: 'sign'
      });

      const keys = await ensureVfsKeys();

      expect(keys.x25519PublicKey).toBeInstanceOf(Uint8Array);
      expect(keys.mlKemPublicKey).toBeInstanceOf(Uint8Array);
      expect(api.vfs.setupKeys).not.toHaveBeenCalled();
    });

    it('generates and stores new keys when none exist', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      const keys = await ensureVfsKeys();

      expect(keys.x25519PublicKey).toBeInstanceOf(Uint8Array);
      expect(keys.mlKemPublicKey).toBeInstanceOf(Uint8Array);
      expect(api.vfs.setupKeys).toHaveBeenCalledWith({
        publicEncryptionKey: 'combined-public-key',
        // publicSigningKey omitted - not yet implemented
        encryptedPrivateKeys: expect.any(String),
        argon2Salt: expect.any(String)
      });
    });

    it('generates and stores new keys when server says keys are not set up', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(
        new Error('VFS keys not set up')
      );
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      const keys = await ensureVfsKeys();

      expect(keys.x25519PublicKey).toBeInstanceOf(Uint8Array);
      expect(keys.mlKemPublicKey).toBeInstanceOf(Uint8Array);
      expect(api.vfs.setupKeys).toHaveBeenCalledTimes(1);
    });

    it('throws when database is not unlocked', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      mockKeyManager.getCurrentKey.mockReturnValueOnce(null);

      await expect(ensureVfsKeys()).rejects.toThrow('Database is not unlocked');
    });
  });

  describe('createVfsKeySetupPayloadForOnboarding', () => {
    it('builds onboarding payload without posting to /vfs/keys', async () => {
      const payload = await createVfsKeySetupPayloadForOnboarding();

      expect(payload).toEqual({
        publicEncryptionKey: 'combined-public-key',
        encryptedPrivateKeys: expect.any(String),
        argon2Salt: expect.any(String)
      });
      expect(api.vfs.setupKeys).not.toHaveBeenCalled();
    });
  });

  describe('ensureVfsKeyPair', () => {
    it('returns decrypted private keys when available', async () => {
      const privateKeyPayload = JSON.stringify({
        x25519PrivateKey: 'dGVzdA==',
        mlKemPrivateKey: 'dGVzdA=='
      });

      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'server-key',
        publicSigningKey: 'sign',
        encryptedPrivateKeys: 'ZW5jcnlwdGVk',
        argon2Salt: 'argon2'
      });

      vi.mocked(decrypt).mockResolvedValueOnce(
        new TextEncoder().encode(privateKeyPayload)
      );

      const keyPair = await ensureVfsKeyPair();

      expect(keyPair.x25519PrivateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.mlKemPrivateKey).toBeInstanceOf(Uint8Array);
    });

    it('throws when private keys are unavailable', async () => {
      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'server-key',
        publicSigningKey: 'sign'
      });

      await expect(ensureVfsKeyPair()).rejects.toThrow(
        'VFS private keys not available'
      );
    });
  });

  describe('wrapSessionKey', () => {
    it('wraps session key with public key', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });

      const sessionKey = new Uint8Array(32).fill(99);
      const wrapped = await wrapSessionKey(sessionKey);

      expect(wrapped).toMatch(/^combined:/);
    });
  });

  describe('registerVfsItemWithCurrentKeys', () => {
    it('wraps and registers by default', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));
      vi.mocked(api.vfs.setupKeys).mockResolvedValueOnce({ created: true });
      vi.mocked(api.vfs.register).mockResolvedValueOnce({
        id: 'item-1',
        createdAt: '2026-02-19T00:00:00.000Z'
      });

      const result = await registerVfsItemWithCurrentKeys({
        id: 'item-1',
        objectType: 'file'
      });

      expect(result.encryptedSessionKey).toMatch(/^combined:/);
      expect(api.vfs.register).toHaveBeenCalledWith({
        id: 'item-1',
        objectType: 'file',
        encryptedSessionKey: result.encryptedSessionKey
      });
    });

    it('skips server registration when registerOnServer is false', async () => {
      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'server-key',
        publicSigningKey: 'sign'
      });

      const result = await registerVfsItemWithCurrentKeys({
        id: 'item-2',
        objectType: 'file',
        registerOnServer: false
      });

      expect(result.encryptedSessionKey).toMatch(/^combined:/);
      expect(api.vfs.register).not.toHaveBeenCalled();
    });
  });

  describe('getVfsPublicKey', () => {
    it('returns public key from server', async () => {
      vi.mocked(api.vfs.getMyKeys).mockResolvedValueOnce({
        publicEncryptionKey: 'server-key',
        publicSigningKey: 'sign'
      });

      const key = await getVfsPublicKey();

      expect(key).not.toBeNull();
      expect(key?.x25519PublicKey).toBeInstanceOf(Uint8Array);
      expect(key?.mlKemPublicKey).toBeInstanceOf(Uint8Array);
    });

    it('returns null when keys do not exist', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('404'));

      const key = await getVfsPublicKey();

      expect(key).toBeNull();
    });

    it('throws on other errors', async () => {
      vi.mocked(api.vfs.getMyKeys).mockRejectedValueOnce(new Error('500'));

      await expect(getVfsPublicKey()).rejects.toThrow('500');
    });
  });
});
