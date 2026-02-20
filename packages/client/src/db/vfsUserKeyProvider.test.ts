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

    it('throws when user is not authenticated', async () => {
      const provider = createUserKeyProvider(() => null);

      await expect(provider.getPublicKeyId()).rejects.toThrow(
        'User is not authenticated'
      );
    });

    it('recomputes key ID when user changes', async () => {
      const { getVfsPublicKey } = await import('@/hooks/useVfsKeys');
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();

      // First user
      vi.mocked(getVfsPublicKey).mockResolvedValue({
        x25519PublicKey: keyPair1.x25519PublicKey,
        mlKemPublicKey: keyPair1.mlKemPublicKey
      });

      let currentUser: { id: string; email: string } | null = {
        id: 'user-1',
        email: 'user1@example.com'
      };

      const provider = createUserKeyProvider(() => currentUser);

      const result1 = await provider.getPublicKeyId();
      expect(getVfsPublicKey).toHaveBeenCalledTimes(1);

      // Same user, should use cache
      const result1Again = await provider.getPublicKeyId();
      expect(result1Again).toBe(result1);
      expect(getVfsPublicKey).toHaveBeenCalledTimes(1);

      // Switch to different user - should recompute
      currentUser = { id: 'user-2', email: 'user2@example.com' };
      vi.mocked(getVfsPublicKey).mockResolvedValue({
        x25519PublicKey: keyPair2.x25519PublicKey,
        mlKemPublicKey: keyPair2.mlKemPublicKey
      });

      const result2 = await provider.getPublicKeyId();
      expect(getVfsPublicKey).toHaveBeenCalledTimes(2);
      // Different keys should produce different IDs
      expect(result2).not.toBe(result1);
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
