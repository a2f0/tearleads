import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';

vi.mock('@/db', () => ({ getDatabase: vi.fn() }));
vi.mock('@/db/localWrite', () => ({
  runLocalWrite: vi.fn((fn: () => Promise<void>) => fn())
}));
vi.mock('@/db/schema', () => ({
  aiConversations: {
    id: 'ai_id',
    encryptedTitle: 'enc_title',
    modelId: 'model',
    messageCount: 'cnt',
    createdAt: 'ca',
    updatedAt: 'ua'
  },
  aiMessages: {
    id: 'msg_id',
    conversationId: 'conv_id',
    role: 'role',
    encryptedContent: 'enc',
    modelId: 'mmodel',
    sequenceNumber: 'seq',
    createdAt: 'mca'
  },
  vfsRegistry: { id: 'vfs_id', encryptedSessionKey: 'esk' }
}));
vi.mock('@/hooks/vfs', () => ({
  ensureVfsKeys: vi.fn().mockResolvedValue(undefined),
  generateSessionKey: vi.fn(() => new Uint8Array([1, 2, 3])),
  wrapSessionKey: vi.fn().mockResolvedValue('wrapped-key')
}));
vi.mock('@/lib/conversationCrypto', () => ({
  decryptContent: vi.fn().mockResolvedValue('decrypted-text'),
  encryptContent: vi.fn().mockResolvedValue('encrypted-text'),
  generateTitleFromMessage: vi.fn((msg: string) => msg.slice(0, 30))
}));
vi.mock('@/lib/vfsItemSyncWriter', () => ({
  queueItemUpsertAndFlush: vi.fn().mockResolvedValue(undefined),
  queueItemDeleteAndFlush: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('./conversationDb', () => ({
  buildCrdtPayload: vi
    .fn()
    .mockResolvedValue({ encryptedTitle: 'enc', messages: [] }),
  cacheSessionKey: vi.fn(),
  evictSessionKey: vi.fn(),
  getCachedSessionKey: vi.fn(),
  getSessionKey: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  toISOString: vi.fn((v: unknown) => String(v)),
  clearConversationKeyCache: vi.fn()
}));
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

import { getDatabase } from '@/db';
import { decryptContent } from '@/lib/conversationCrypto';
import { getCachedSessionKey, getSessionKey } from './conversationDb';
import { useConversations } from './useConversations';
import { createChainableDb } from './useConversations.testUtils';

describe('useConversations queries', () => {
  let mockDb: ReturnType<typeof createChainableDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createChainableDb();
    vi.mocked(getDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDatabase>
    );
    vi.mocked(getSessionKey).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(decryptContent).mockResolvedValue('decrypted-text');
    vi.mocked(getCachedSessionKey).mockReturnValue(new Uint8Array([4, 5, 6]));
  });

  describe('fetchConversations', () => {
    it('decrypts titles when encryptedSessionKey is present', async () => {
      const rows = [
        {
          id: 'c1',
          encryptedTitle: 'enc-title',
          modelId: null,
          messageCount: 2,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
          encryptedSessionKey: 'esk-1'
        }
      ];
      mockDb = createChainableDb(rows);
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.conversations).toHaveLength(1);
      expect(result.current.conversations[0]?.title).toBe('decrypted-text');
    });

    it('shows [Encrypted] when encryptedSessionKey is null', async () => {
      const rows = [
        {
          id: 'c2',
          encryptedTitle: 'enc',
          modelId: null,
          messageCount: 0,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
          encryptedSessionKey: null
        }
      ];
      mockDb = createChainableDb(rows);
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.conversations[0]?.title).toBe('[Encrypted]');
    });

    it('shows [Encrypted] when decryption throws', async () => {
      const consoleSpy = mockConsoleError();
      const rows = [
        {
          id: 'c3',
          encryptedTitle: 'enc',
          modelId: null,
          messageCount: 0,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
          encryptedSessionKey: 'esk-bad'
        }
      ];
      mockDb = createChainableDb(rows);
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );
      vi.mocked(getSessionKey).mockRejectedValueOnce(new Error('key failure'));

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.conversations[0]?.title).toBe('[Encrypted]');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to decrypt conversation c3:',
        expect.objectContaining({ message: 'key failure' })
      );
      consoleSpy.mockRestore();
    });

    it('sets error when outer fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      vi.mocked(getDatabase).mockImplementation(() => {
        throw new Error('db boom');
      });

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('db boom');
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('selectConversation', () => {
    it('clears state when id is null', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation();
      });

      await act(async () => {
        await result.current.selectConversation(null);
      });

      expect(result.current.currentConversationId).toBeNull();
      expect(result.current.currentMessages).toHaveLength(0);
      expect(result.current.currentSessionKey).toBeNull();
    });

    it('loads messages for a valid conversation', async () => {
      const msgs = [
        {
          id: 'm1',
          conversationId: 'c1',
          role: 'user',
          encryptedContent: 'enc-msg',
          modelId: null,
          sequenceNumber: 1,
          createdAt: '2024-01-01'
        }
      ];
      const vfsRow = [{ encryptedSessionKey: 'esk-valid' }];

      const selectFromChain = {
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(vfsRow),
            orderBy: vi.fn().mockResolvedValue(msgs)
          }),
          innerJoin: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([])
          })
        }))
      };
      mockDb.select.mockReturnValue(
        selectFromChain as ReturnType<typeof mockDb.select>
      );

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.selectConversation('c1');
      });

      expect(result.current.currentConversationId).toBe('c1');
      expect(result.current.currentMessages).toHaveLength(1);
      expect(result.current.currentMessages[0]?.content).toBe('decrypted-text');
      expect(result.current.messagesLoading).toBe(false);
    });

    it('sets error when session key not found', async () => {
      const consoleSpy = mockConsoleError();
      const selectFromChain = {
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ encryptedSessionKey: null }])
          }),
          innerJoin: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([])
          })
        }))
      };
      mockDb.select.mockReturnValue(
        selectFromChain as ReturnType<typeof mockDb.select>
      );

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.selectConversation('c-missing');
      });

      expect(result.current.error).toBe(
        'Session key not found for conversation'
      );
      expect(result.current.currentSessionKey).toBeNull();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('refetch', () => {
    it('reloads conversations from database', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const rows = [
        {
          id: 'r1',
          encryptedTitle: 'enc',
          modelId: null,
          messageCount: 1,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
          encryptedSessionKey: 'esk'
        }
      ];
      mockDb = createChainableDb(rows);
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.conversations).toHaveLength(1);
    });
  });
});
