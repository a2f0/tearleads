import { generateKeyPair, type VfsKeyPair } from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearUserKeyProviderCache,
  createUserKeyProvider
} from './vfsUserKeyProvider';

vi.mock('@/hooks/useVfsKeys', () => ({
  ensureVfsKeyPair: vi.fn(),
  getVfsPublicKey: vi.fn()
}));

describe('vfsUserKeyProvider', () => {
  let mockKeyPair: VfsKeyPair;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearUserKeyProviderCache();
    mockKeyPair = generateKeyPair();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUserKeyPair', () => {
    it('returns the VFS keypair from ensureVfsKeyPair', async () => {
      const { ensureVfsKeyPair } = await import('@/hooks/useVfsKeys');
      vi.mocked(ensureVfsKeyPair).mockResolvedValue(mockKeyPair);

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      const result = await provider.getUserKeyPair();

      expect(result).toBe(mockKeyPair);
      expect(ensureVfsKeyPair).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from ensureVfsKeyPair', async () => {
      const { ensureVfsKeyPair } = await import('@/hooks/useVfsKeys');
      vi.mocked(ensureVfsKeyPair).mockRejectedValue(
        new Error('Keys not set up')
      );

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      await expect(provider.getUserKeyPair()).rejects.toThrow(
        'Keys not set up'
      );
    });
  });

  describe('getUserId', () => {
    it('returns the user ID from the auth context', async () => {
      const provider = createUserKeyProvider(() => ({
        id: 'user-123',
        email: 'test@example.com'
      }));

      const result = await provider.getUserId();

      expect(result).toBe('user-123');
    });

    it('throws when user is not authenticated', async () => {
      const provider = createUserKeyProvider(() => null);

      await expect(provider.getUserId()).rejects.toThrow(
        'User is not authenticated'
      );
    });
  });

  describe('getPublicKeyId', () => {
    it('derives public key ID from VFS public key', async () => {
      const { getVfsPublicKey } = await import('@/hooks/useVfsKeys');
      vi.mocked(getVfsPublicKey).mockResolvedValue({
        x25519PublicKey: mockKeyPair.x25519PublicKey,
        mlKemPublicKey: mockKeyPair.mlKemPublicKey
      });

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      const result = await provider.getPublicKeyId();

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Base64url encoded 16 bytes = ~22 chars
      expect(result.length).toBeLessThanOrEqual(24);
    });

    it('caches the public key ID', async () => {
      const { getVfsPublicKey } = await import('@/hooks/useVfsKeys');
      vi.mocked(getVfsPublicKey).mockResolvedValue({
        x25519PublicKey: mockKeyPair.x25519PublicKey,
        mlKemPublicKey: mockKeyPair.mlKemPublicKey
      });

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      const result1 = await provider.getPublicKeyId();
      const result2 = await provider.getPublicKeyId();

      expect(result1).toBe(result2);
      expect(getVfsPublicKey).toHaveBeenCalledTimes(1);
    });

    it('throws when VFS public key is not available', async () => {
      const { getVfsPublicKey } = await import('@/hooks/useVfsKeys');
      vi.mocked(getVfsPublicKey).mockResolvedValue(null);

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      await expect(provider.getPublicKeyId()).rejects.toThrow(
        'VFS public key not available'
      );
    });
  });

  describe('clearUserKeyProviderCache', () => {
    it('clears the cached public key ID', async () => {
      const { getVfsPublicKey } = await import('@/hooks/useVfsKeys');
      vi.mocked(getVfsPublicKey).mockResolvedValue({
        x25519PublicKey: mockKeyPair.x25519PublicKey,
        mlKemPublicKey: mockKeyPair.mlKemPublicKey
      });

      const provider = createUserKeyProvider(() => ({
        id: 'user-1',
        email: 'test@example.com'
      }));

      await provider.getPublicKeyId();
      expect(getVfsPublicKey).toHaveBeenCalledTimes(1);

      clearUserKeyProviderCache();
      await provider.getPublicKeyId();
      expect(getVfsPublicKey).toHaveBeenCalledTimes(2);
    });
  });
});
