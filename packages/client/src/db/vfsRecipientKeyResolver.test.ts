import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecipientKeyCache,
  createRecipientPublicKeyResolver,
  createRecipientPublicKeyResolverWithKeys
} from './vfsRecipientKeyResolver';

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      searchShareTargets: vi.fn()
    }
  }
}));

describe('vfsRecipientKeyResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRecipientKeyCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createRecipientPublicKeyResolver', () => {
    it('resolves public key from API', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockResolvedValue({
        results: [
          {
            id: 'user-123',
            type: 'user',
            name: 'Test User',
            publicEncryptionKey: 'pk-x25519:abc123.pk-mlkem:def456'
          }
        ]
      });

      const resolver = createRecipientPublicKeyResolver();
      const result = await resolver.resolvePublicKey('user-123');

      expect(result).not.toBeNull();
      expect(result?.publicEncryptionKey).toBe(
        'pk-x25519:abc123.pk-mlkem:def456'
      );
      expect(result?.publicKeyId).toBeDefined();
      expect(api.vfs.searchShareTargets).toHaveBeenCalledWith(
        'user-123',
        'user'
      );
    });

    it('returns null when user not found', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockResolvedValue({
        results: []
      });

      const resolver = createRecipientPublicKeyResolver();
      const result = await resolver.resolvePublicKey('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when user has no public key', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockResolvedValue({
        results: [
          {
            id: 'user-123',
            type: 'user',
            name: 'Test User'
            // No publicEncryptionKey
          }
        ]
      });

      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const resolver = createRecipientPublicKeyResolver();
      const result = await resolver.resolvePublicKey('user-123');

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('no public key available')
      );

      consoleWarnSpy.mockRestore();
    });

    it('caches resolved keys', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockResolvedValue({
        results: [
          {
            id: 'user-123',
            type: 'user',
            name: 'Test User',
            publicEncryptionKey: 'pk-x25519:abc123.pk-mlkem:def456'
          }
        ]
      });

      const resolver = createRecipientPublicKeyResolver();
      const result1 = await resolver.resolvePublicKey('user-123');
      const result2 = await resolver.resolvePublicKey('user-123');

      expect(result1).toEqual(result2);
      expect(api.vfs.searchShareTargets).toHaveBeenCalledTimes(1);
    });

    it('handles API errors gracefully', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockRejectedValue(
        new Error('Network error')
      );

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const resolver = createRecipientPublicKeyResolver();
      const result = await resolver.resolvePublicKey('user-123');

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve public key'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('createRecipientPublicKeyResolverWithKeys', () => {
    it('resolves keys from provided map', async () => {
      const knownKeys = new Map([
        [
          'user-1',
          {
            publicKeyId: 'pk-1',
            publicEncryptionKey: 'key-1'
          }
        ],
        [
          'user-2',
          {
            publicKeyId: 'pk-2',
            publicEncryptionKey: 'key-2'
          }
        ]
      ]);

      const resolver = createRecipientPublicKeyResolverWithKeys(knownKeys);

      const result1 = await resolver.resolvePublicKey('user-1');
      expect(result1).toEqual({
        publicKeyId: 'pk-1',
        publicEncryptionKey: 'key-1'
      });

      const result2 = await resolver.resolvePublicKey('user-2');
      expect(result2).toEqual({
        publicKeyId: 'pk-2',
        publicEncryptionKey: 'key-2'
      });
    });

    it('returns null for unknown users', async () => {
      const knownKeys = new Map([
        [
          'user-1',
          {
            publicKeyId: 'pk-1',
            publicEncryptionKey: 'key-1'
          }
        ]
      ]);

      const resolver = createRecipientPublicKeyResolverWithKeys(knownKeys);
      const result = await resolver.resolvePublicKey('unknown-user');

      expect(result).toBeNull();
    });
  });

  describe('clearRecipientKeyCache', () => {
    it('clears the cache so keys are re-fetched', async () => {
      const { api } = await import('@/lib/api');
      vi.mocked(api.vfs.searchShareTargets).mockResolvedValue({
        results: [
          {
            id: 'user-123',
            type: 'user',
            name: 'Test User',
            publicEncryptionKey: 'pk-x25519:abc123.pk-mlkem:def456'
          }
        ]
      });

      const resolver = createRecipientPublicKeyResolver();
      await resolver.resolvePublicKey('user-123');
      expect(api.vfs.searchShareTargets).toHaveBeenCalledTimes(1);

      clearRecipientKeyCache();
      await resolver.resolvePublicKey('user-123');
      expect(api.vfs.searchShareTargets).toHaveBeenCalledTimes(2);
    });
  });
});
