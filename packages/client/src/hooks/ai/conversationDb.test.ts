import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureVfsKeyPair = vi.fn();
const mockUnwrapConversationSessionKey = vi.fn();

vi.mock('@/hooks/vfs', () => ({
  ensureVfsKeyPair: (...args: unknown[]) => mockEnsureVfsKeyPair(...args)
}));

vi.mock('@/lib/conversationCrypto', () => ({
  unwrapConversationSessionKey: (...args: unknown[]) =>
    mockUnwrapConversationSessionKey(...args)
}));

const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

const mockDb = { select: mockSelect };

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/schema', () => ({
  aiMessages: {
    conversationId: 'conversationId',
    sequenceNumber: 'sequenceNumber'
  }
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: string) => ({ col, val }),
  asc: (col: string) => ({ col, direction: 'asc' })
}));

import {
  buildCrdtPayload,
  cacheSessionKey,
  clearConversationKeyCache,
  evictSessionKey,
  getCachedSessionKey,
  getSessionKey,
  toISOString
} from './conversationDb';

describe('conversationDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConversationKeyCache();

    mockEnsureVfsKeyPair.mockResolvedValue({
      x25519PublicKey: new Uint8Array(32),
      x25519PrivateKey: new Uint8Array(32),
      mlKemPublicKey: new Uint8Array(1184),
      mlKemPrivateKey: new Uint8Array(2400)
    });
    mockUnwrapConversationSessionKey.mockResolvedValue(
      new Uint8Array(32).fill(42)
    );

    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValue([]);
  });

  describe('getSessionKey', () => {
    it('unwraps and caches a new session key', async () => {
      const key = await getSessionKey('conv-1', 'enc-session-key');

      expect(mockEnsureVfsKeyPair).toHaveBeenCalledOnce();
      expect(mockUnwrapConversationSessionKey).toHaveBeenCalledWith(
        'enc-session-key',
        expect.objectContaining({ x25519PublicKey: expect.any(Uint8Array) })
      );
      expect(key).toEqual(new Uint8Array(32).fill(42));
    });

    it('returns cached key on second call without re-unwrapping', async () => {
      await getSessionKey('conv-2', 'enc-key');
      const second = await getSessionKey('conv-2', 'enc-key');

      expect(mockUnwrapConversationSessionKey).toHaveBeenCalledOnce();
      expect(second).toEqual(new Uint8Array(32).fill(42));
    });

    it('throws a user-friendly error when unwrap fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockUnwrapConversationSessionKey.mockRejectedValue(
        new Error('crypto failure')
      );

      await expect(getSessionKey('conv-3', 'bad-key')).rejects.toThrow(
        'Cannot decrypt conversation'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to unwrap conversation session key:',
        expect.objectContaining({ message: 'crypto failure' })
      );
      consoleSpy.mockRestore();
    });

    it('logs the original error to console.error on failure', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalError = new Error('crypto failure');
      mockUnwrapConversationSessionKey.mockRejectedValue(originalError);

      await expect(getSessionKey('conv-4', 'bad-key')).rejects.toThrow();

      expect(spy).toHaveBeenCalledWith(
        'Failed to unwrap conversation session key:',
        originalError
      );
      spy.mockRestore();
    });
  });

  describe('cacheSessionKey', () => {
    it('stores a key that can be retrieved', () => {
      const key = new Uint8Array([10, 20, 30]);
      cacheSessionKey('conv-a', key);

      expect(getCachedSessionKey('conv-a')).toBe(key);
    });
  });

  describe('getCachedSessionKey', () => {
    it('returns undefined for unknown ids', () => {
      expect(getCachedSessionKey('nonexistent')).toBeUndefined();
    });

    it('returns the cached key after caching', () => {
      const key = new Uint8Array([1, 2, 3]);
      cacheSessionKey('conv-b', key);
      expect(getCachedSessionKey('conv-b')).toBe(key);
    });
  });

  describe('evictSessionKey', () => {
    it('zeroes and removes a cached key', () => {
      const key = new Uint8Array([5, 6, 7]);
      cacheSessionKey('conv-c', key);

      evictSessionKey('conv-c');

      expect(getCachedSessionKey('conv-c')).toBeUndefined();
      expect(key.every((b) => b === 0)).toBe(true);
    });

    it('does nothing when key is not cached', () => {
      expect(() => evictSessionKey('missing')).not.toThrow();
    });
  });

  describe('clearConversationKeyCache', () => {
    it('zeroes all cached keys and clears the cache', () => {
      const key1 = new Uint8Array([1, 2, 3]);
      const key2 = new Uint8Array([4, 5, 6]);
      cacheSessionKey('c1', key1);
      cacheSessionKey('c2', key2);

      clearConversationKeyCache();

      expect(getCachedSessionKey('c1')).toBeUndefined();
      expect(getCachedSessionKey('c2')).toBeUndefined();
      expect(key1.every((b) => b === 0)).toBe(true);
      expect(key2.every((b) => b === 0)).toBe(true);
    });

    it('does nothing when cache is empty', () => {
      expect(() => clearConversationKeyCache()).not.toThrow();
    });
  });

  describe('buildCrdtPayload', () => {
    it('builds payload with messages ordered by sequence number', async () => {
      const createdDate = new Date('2025-06-01T12:00:00.000Z');
      mockOrderBy.mockResolvedValue([
        {
          id: 'msg-1',
          role: 'user',
          encryptedContent: 'enc-content-1',
          modelId: null,
          sequenceNumber: 1,
          createdAt: createdDate
        },
        {
          id: 'msg-2',
          role: 'assistant',
          encryptedContent: 'enc-content-2',
          modelId: 'gpt-4',
          sequenceNumber: 2,
          createdAt: '2025-06-01T12:01:00.000Z'
        }
      ]);

      const payload = await buildCrdtPayload(
        'conv-x',
        'encrypted-title',
        'gpt-4'
      );

      expect(payload.encryptedTitle).toBe('encrypted-title');
      expect(payload.modelId).toBe('gpt-4');
      expect(payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      const messages = payload.messages;
      expect(Array.isArray(messages)).toBe(true);

      const msgArray = messages as Array<Record<string, unknown>>;
      expect(msgArray).toHaveLength(2);

      expect(msgArray[0]).toEqual({
        id: 'msg-1',
        role: 'user',
        encryptedContent: 'enc-content-1',
        modelId: null,
        sequenceNumber: 1,
        createdAt: '2025-06-01T12:00:00.000Z'
      });

      expect(msgArray[1]).toEqual({
        id: 'msg-2',
        role: 'assistant',
        encryptedContent: 'enc-content-2',
        modelId: 'gpt-4',
        sequenceNumber: 2,
        createdAt: '2025-06-01T12:01:00.000Z'
      });
    });

    it('handles null modelId', async () => {
      mockOrderBy.mockResolvedValue([]);

      const payload = await buildCrdtPayload('conv-y', 'title', null);

      expect(payload.modelId).toBeNull();
      const msgArray = payload.messages as Array<Record<string, unknown>>;
      expect(msgArray).toHaveLength(0);
    });

    it('queries the correct table with conversation id filter', async () => {
      mockOrderBy.mockResolvedValue([]);

      await buildCrdtPayload('conv-z', 'title', 'model');

      expect(mockSelect).toHaveBeenCalledOnce();
      expect(mockFrom).toHaveBeenCalledOnce();
      expect(mockWhere).toHaveBeenCalledOnce();
      expect(mockOrderBy).toHaveBeenCalledOnce();
    });

    it('converts Date createdAt to ISO string', async () => {
      mockOrderBy.mockResolvedValue([
        {
          id: 'msg-d',
          role: 'user',
          encryptedContent: 'enc',
          modelId: null,
          sequenceNumber: 1,
          createdAt: new Date('2025-03-15T08:30:00.000Z')
        }
      ]);

      const payload = await buildCrdtPayload('conv-d', 'title', null);
      const msgArray = payload.messages as Array<Record<string, unknown>>;
      expect(msgArray[0]?.createdAt).toBe('2025-03-15T08:30:00.000Z');
    });

    it('converts non-Date createdAt to string via String()', async () => {
      mockOrderBy.mockResolvedValue([
        {
          id: 'msg-e',
          role: 'assistant',
          encryptedContent: 'enc',
          modelId: null,
          sequenceNumber: 1,
          createdAt: 1718280000000
        }
      ]);

      const payload = await buildCrdtPayload('conv-e', 'title', null);
      const msgArray = payload.messages as Array<Record<string, unknown>>;
      expect(msgArray[0]?.createdAt).toBe('1718280000000');
    });
  });

  describe('toISOString', () => {
    it('converts a Date to ISO string', () => {
      const date = new Date('2025-01-15T10:30:00.000Z');
      expect(toISOString(date)).toBe('2025-01-15T10:30:00.000Z');
    });

    it('converts a string value via String()', () => {
      expect(toISOString('2025-01-15')).toBe('2025-01-15');
    });

    it('converts a numeric timestamp via String()', () => {
      expect(toISOString(1705312200000)).toBe('1705312200000');
    });

    it('handles an empty string', () => {
      expect(toISOString('')).toBe('');
    });

    it('handles zero', () => {
      expect(toISOString(0)).toBe('0');
    });
  });
});
