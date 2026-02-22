/**
 * Tests for useConversations hook.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearConversationKeyCache,
  useConversations
} from './useConversations';

// Mock the API
const mockListConversations = vi.fn();
const mockCreateConversation = vi.fn();
const mockGetConversation = vi.fn();
const mockUpdateConversation = vi.fn();
const mockDeleteConversation = vi.fn();
const mockAddMessage = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    ai: {
      listConversations: (...args: unknown[]) => mockListConversations(...args),
      createConversation: (...args: unknown[]) =>
        mockCreateConversation(...args),
      getConversation: (...args: unknown[]) => mockGetConversation(...args),
      updateConversation: (...args: unknown[]) =>
        mockUpdateConversation(...args),
      deleteConversation: (...args: unknown[]) =>
        mockDeleteConversation(...args),
      addMessage: (...args: unknown[]) => mockAddMessage(...args)
    }
  }
}));

// Mock conversation crypto
vi.mock('@/lib/conversationCrypto', () => ({
  createConversationEncryption: vi.fn().mockResolvedValue({
    encryptedTitle: 'encrypted-title',
    encryptedSessionKey: 'encrypted-key',
    sessionKey: new Uint8Array(32)
  }),
  decryptConversation: vi.fn().mockImplementation((conv) =>
    Promise.resolve({
      ...conv,
      title: 'Decrypted Title'
    })
  ),
  decryptMessages: vi.fn().mockResolvedValue([]),
  encryptMessage: vi.fn().mockResolvedValue('encrypted-content'),
  encryptTitle: vi.fn().mockResolvedValue('encrypted-title'),
  generateTitleFromMessage: vi.fn().mockReturnValue('Generated Title')
}));

// Mock VFS keys
vi.mock('@/hooks/vfs', () => ({
  ensureVfsKeyPair: vi.fn().mockResolvedValue({
    x25519PublicKey: new Uint8Array(32),
    x25519PrivateKey: new Uint8Array(32),
    mlKemPublicKey: new Uint8Array(1184),
    mlKemPrivateKey: new Uint8Array(2400)
  })
}));describe('useConversations', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    clearConversationKeyCache();

    // Default mock implementations
    mockListConversations.mockResolvedValue({
      conversations: [],
      hasMore: false
    });
  });

  afterEach(() => {
    clearConversationKeyCache();
  });

  it('adds a message to current conversation', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    mockAddMessage.mockResolvedValue({
      message: {
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'user',
        encryptedContent: 'encrypted-content',
        modelId: null,
        sequenceNumber: 1,
        createdAt: now
      },
      conversation: {
        id: 'conv-1',
        messageCount: 1,
        updatedAt: now
      }
    });

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create a conversation first
    await act(async () => {
      await result.current.createConversation('Hello');
    });

    // Add a message
    await act(async () => {
      await result.current.addMessage('user', 'Hello world');
    });

    expect(mockAddMessage).toHaveBeenCalledWith('conv-1', {
      role: 'user',
      encryptedContent: 'encrypted-content'
    });

    expect(result.current.currentMessages).toHaveLength(1);
    expect(result.current.currentMessages[0]?.content).toBe('Hello world');
  });

  it('adds a message with modelId', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    mockAddMessage.mockResolvedValue({
      message: {
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        encryptedContent: 'encrypted-content',
        modelId: 'gpt-4',
        sequenceNumber: 1,
        createdAt: now
      },
      conversation: {
        id: 'conv-1',
        messageCount: 1,
        updatedAt: now
      }
    });

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create a conversation first
    await act(async () => {
      await result.current.createConversation('Hello');
    });

    // Add a message with modelId
    await act(async () => {
      await result.current.addMessage('assistant', 'Hello!', 'gpt-4');
    });

    expect(mockAddMessage).toHaveBeenCalledWith('conv-1', {
      role: 'assistant',
      encryptedContent: 'encrypted-content',
      modelId: 'gpt-4'
    });
  });

  it('throws error when adding message without selected conversation', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Try to add message without selecting a conversation
    await expect(async () => {
      await result.current.addMessage('user', 'Hello');
    }).rejects.toThrow('No conversation selected');
  });

  it('clears current conversation when deleting it', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    mockDeleteConversation.mockResolvedValue({});

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create a conversation (which sets it as current)
    await act(async () => {
      await result.current.createConversation('Hello');
    });

    expect(result.current.currentConversationId).toBe('conv-1');

    // Delete the current conversation
    await act(async () => {
      await result.current.deleteConversation('conv-1');
    });

    expect(result.current.currentConversationId).toBeNull();
    expect(result.current.currentMessages).toEqual([]);
    expect(result.current.currentSessionKey).toBeNull();
  });

  it('creates conversation without first message', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'new-conv',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let convId: string | undefined;
    await act(async () => {
      convId = await result.current.createConversation();
    });

    expect(convId).toBe('new-conv');
    expect(mockCreateConversation).toHaveBeenCalled();
  });

  it('handles select conversation error', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    mockGetConversation.mockRejectedValue(new Error('Failed to load'));

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create a conversation first to have the session key
    await act(async () => {
      await result.current.createConversation('Hello');
    });

    // Clear error from creation
    expect(result.current.error).toBeNull();

    // Try to select - should handle error
    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    expect(result.current.error).toBe('Failed to load');
    expect(result.current.currentMessages).toEqual([]);
    expect(result.current.currentSessionKey).toBeNull();
  });

  it('handles non-Error throws gracefully', async () => {
    mockListConversations.mockRejectedValue('string error');

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load conversations');
  });

  it('handles non-Error throws in selectConversation', async () => {
    const now = new Date().toISOString();

    mockCreateConversation.mockResolvedValue({
      conversation: {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key',
        modelId: null,
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });

    mockGetConversation.mockRejectedValue('string error');

    const { result } = renderHook(() => useConversations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create a conversation first
    await act(async () => {
      await result.current.createConversation('Hello');
    });

    // Try to select
    await act(async () => {
      await result.current.selectConversation('conv-1');
    });

    expect(result.current.error).toBe('Failed to load conversation');
  });
});
