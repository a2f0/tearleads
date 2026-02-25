import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('useConversations mutations', () => {
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

  describe('createConversation', () => {
    it('creates with default title when no firstMessage', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let id: string | undefined;
      await act(async () => {
        id = await result.current.createConversation();
      });

      expect(id).toBe('test-uuid-1234');
      expect(result.current.conversations[0]?.title).toBe('New Conversation');
      expect(result.current.currentConversationId).toBe('test-uuid-1234');
    });

    it('creates with generated title from firstMessage', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('Hello world');
      });

      expect(result.current.conversations[0]?.title).toBe('Hello world');
    });
  });

  describe('renameConversation', () => {
    it('renames when session key is cached', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('Original');
      });

      await act(async () => {
        await result.current.renameConversation('test-uuid-1234', 'Renamed');
      });

      expect(result.current.conversations[0]?.title).toBe('Renamed');
    });

    it('throws when session key is not cached', async () => {
      vi.mocked(getCachedSessionKey).mockReturnValue(undefined);

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.renameConversation('no-key', 'New Title');
        })
      ).rejects.toThrow('Cannot rename - session key not available');
    });
  });

  describe('deleteConversation', () => {
    it('removes conversation from list', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('To delete');
      });

      expect(result.current.conversations).toHaveLength(1);

      await act(async () => {
        await result.current.deleteConversation('test-uuid-1234');
      });

      expect(result.current.conversations).toHaveLength(0);
    });

    it('clears current conversation when deleting the active one', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('Active conv');
      });

      expect(result.current.currentConversationId).toBe('test-uuid-1234');

      await act(async () => {
        await result.current.deleteConversation('test-uuid-1234');
      });

      expect(result.current.currentConversationId).toBeNull();
      expect(result.current.currentMessages).toHaveLength(0);
      expect(result.current.currentSessionKey).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('throws when no conversation is selected', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.addMessage('user', 'hello');
        })
      ).rejects.toThrow('No conversation selected');
    });

    it('adds a message to the current conversation', async () => {
      const convRow = [{ encryptedTitle: 'enc-title', modelId: null }];
      let selectCallCount = 0;
      const selectImpl = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          innerJoin: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([])
          }),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount <= 1)
                return Promise.resolve([{ encryptedSessionKey: 'esk' }]);
              return Promise.resolve(convRow);
            }),
            orderBy: vi.fn().mockResolvedValue([])
          })
        }))
      }));
      mockDb.select = selectImpl;

      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('Test conv');
      });

      await act(async () => {
        await result.current.addMessage('user', 'Hello AI', 'gpt-4');
      });

      expect(result.current.currentMessages).toHaveLength(1);
      expect(result.current.currentMessages[0]?.content).toBe('Hello AI');
      expect(result.current.currentMessages[0]?.role).toBe('user');
      expect(result.current.currentMessages[0]?.modelId).toBe('gpt-4');
    });
  });

  describe('clearCurrentConversation', () => {
    it('resets current conversation state', async () => {
      const { result } = renderHook(() => useConversations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createConversation('Active');
      });

      expect(result.current.currentConversationId).toBe('test-uuid-1234');

      act(() => {
        result.current.clearCurrentConversation();
      });

      expect(result.current.currentConversationId).toBeNull();
      expect(result.current.currentMessages).toHaveLength(0);
      expect(result.current.currentSessionKey).toBeNull();
    });
  });
});
