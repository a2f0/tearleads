/**
 * Tests for conversation encryption utilities.
 */
import type { AiConversation, AiMessage } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationEncryption,
  decryptContent,
  decryptConversation,
  decryptMessages,
  encryptContent,
  encryptMessage,
  encryptTitle,
  generateTitleFromMessage,
  unwrapConversationSessionKey
} from './conversationCrypto';

// Mock the shared crypto module
const mockDecrypt = vi.fn();
const mockEncrypt = vi.fn();
const mockImportKey = vi.fn();
const mockSplitEncapsulation = vi.fn();
const mockUnwrapKeyWithKeyPair = vi.fn();

vi.mock('@tearleads/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tearleads/shared')>();
  return {
    ...actual,
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
    encrypt: (...args: unknown[]) => mockEncrypt(...args),
    importKey: (...args: unknown[]) => mockImportKey(...args),
    splitEncapsulation: (...args: unknown[]) => mockSplitEncapsulation(...args),
    unwrapKeyWithKeyPair: (...args: unknown[]) =>
      mockUnwrapKeyWithKeyPair(...args)
  };
});

// Mock the VFS keys hook
const mockEnsureVfsKeys = vi.fn();
const mockGenerateSessionKey = vi.fn();
const mockWrapSessionKey = vi.fn();

vi.mock('@/hooks/vfs', () => ({
  ensureVfsKeys: (...args: unknown[]) => mockEnsureVfsKeys(...args),
  generateSessionKey: (...args: unknown[]) => mockGenerateSessionKey(...args),
  wrapSessionKey: (...args: unknown[]) => mockWrapSessionKey(...args)
}));

describe('conversation-crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mocks
    mockDecrypt.mockResolvedValue(new TextEncoder().encode('decrypted'));
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockImportKey.mockResolvedValue({} as CryptoKey);
    mockSplitEncapsulation.mockReturnValue({
      x25519: new Uint8Array(32),
      mlKem: new Uint8Array(1088),
      ciphertext: new Uint8Array(32)
    });
    mockUnwrapKeyWithKeyPair.mockReturnValue(new Uint8Array(32));
    mockEnsureVfsKeys.mockResolvedValue({
      x25519PublicKey: new Uint8Array(32),
      mlKemPublicKey: new Uint8Array(1184)
    });
    mockGenerateSessionKey.mockReturnValue(new Uint8Array(32));
    mockWrapSessionKey.mockResolvedValue('wrapped-key-base64');
  });

  describe('encryptContent', () => {
    it('encrypts content and returns base64', async () => {
      const result = await encryptContent('hello', new Uint8Array(32));

      expect(mockImportKey).toHaveBeenCalled();
      expect(mockEncrypt).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });
  });

  describe('decryptContent', () => {
    it('decrypts base64 content to string', async () => {
      const encryptedBase64 = btoa('encrypted');
      const result = await decryptContent(encryptedBase64, new Uint8Array(32));

      expect(mockImportKey).toHaveBeenCalled();
      expect(mockDecrypt).toHaveBeenCalled();
      expect(result).toBe('decrypted');
    });
  });

  describe('encryptMessage', () => {
    it('encrypts message content', async () => {
      const result = await encryptMessage('hello', new Uint8Array(32));

      expect(mockEncrypt).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });
  });

  describe('encryptTitle', () => {
    it('encrypts title', async () => {
      const result = await encryptTitle('My Title', new Uint8Array(32));

      expect(mockEncrypt).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });
  });

  describe('unwrapConversationSessionKey', () => {
    it('unwraps session key using keypair', async () => {
      const keyPair = {
        x25519PublicKey: new Uint8Array(32),
        x25519PrivateKey: new Uint8Array(32),
        mlKemPublicKey: new Uint8Array(1184),
        mlKemPrivateKey: new Uint8Array(2400)
      };

      const result = await unwrapConversationSessionKey(
        'encrypted-session-key',
        keyPair
      );

      expect(mockSplitEncapsulation).toHaveBeenCalledWith(
        'encrypted-session-key'
      );
      expect(mockUnwrapKeyWithKeyPair).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('createConversationEncryption', () => {
    it('creates encryption data for new conversation', async () => {
      const result = await createConversationEncryption('Test Title');

      expect(mockEnsureVfsKeys).toHaveBeenCalled();
      expect(mockGenerateSessionKey).toHaveBeenCalled();
      expect(mockWrapSessionKey).toHaveBeenCalled();

      expect(result).toHaveProperty('encryptedTitle');
      expect(result).toHaveProperty('encryptedSessionKey');
      expect(result).toHaveProperty('sessionKey');
      expect(result.encryptedSessionKey).toBe('wrapped-key-base64');
    });
  });

  describe('decryptConversation', () => {
    it('decrypts conversation data', async () => {
      const conversation: AiConversation = {
        id: 'conv-1',
        userId: 'user-1',
        organizationId: null,
        encryptedTitle: btoa('encrypted-title'),
        encryptedSessionKey: 'session-key',
        modelId: 'gpt-4',
        messageCount: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      const result = await decryptConversation(
        conversation,
        new Uint8Array(32)
      );

      expect(result.id).toBe('conv-1');
      expect(result.userId).toBe('user-1');
      expect(result.organizationId).toBeNull();
      expect(result.title).toBe('decrypted');
      expect(result.modelId).toBe('gpt-4');
      expect(result.messageCount).toBe(5);
    });
  });

  describe('decryptMessages', () => {
    it('decrypts all messages in array', async () => {
      const messages: AiMessage[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          encryptedContent: btoa('hello'),
          modelId: null,
          sequenceNumber: 1,
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          role: 'assistant',
          encryptedContent: btoa('hi'),
          modelId: 'gpt-4',
          sequenceNumber: 2,
          createdAt: '2024-01-01T00:00:01Z'
        }
      ];

      const result = await decryptMessages(messages, new Uint8Array(32));

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('msg-1');
      expect(result[0]?.role).toBe('user');
      expect(result[0]?.content).toBe('decrypted');
      expect(result[1]?.id).toBe('msg-2');
      expect(result[1]?.role).toBe('assistant');
      expect(result[1]?.modelId).toBe('gpt-4');
    });

    it('handles empty message array', async () => {
      const result = await decryptMessages([], new Uint8Array(32));
      expect(result).toEqual([]);
    });
  });

  describe('generateTitleFromMessage', () => {
    it('returns the content as-is when short enough', () => {
      const content = 'Hello world';
      expect(generateTitleFromMessage(content)).toBe('Hello world');
    });

    it('trims whitespace from content', () => {
      const content = '  Hello world  ';
      expect(generateTitleFromMessage(content)).toBe('Hello world');
    });

    it('replaces newlines with spaces', () => {
      const content = 'Hello\nworld\ntest';
      expect(generateTitleFromMessage(content)).toBe('Hello world test');
    });

    it('truncates long content at a word boundary', () => {
      const content =
        'This is a very long message that exceeds the maximum length and should be truncated at a word boundary';
      const result = generateTitleFromMessage(content);
      expect(result.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(result.endsWith('...')).toBe(true);
      // Should break at a space
      expect(result.slice(0, -3).endsWith(' ')).toBe(false);
    });

    it('truncates at MAX_LENGTH if no good break point', () => {
      const content =
        'Thisisaverylongmessagewithnospacesorbreakpointsthatexceedsthemaximumlengthallowed';
      const result = generateTitleFromMessage(content);
      expect(result).toBe(
        'Thisisaverylongmessagewithnospacesorbreakpointstha...'
      );
    });

    it('handles exactly MAX_LENGTH content', () => {
      const content = 'a'.repeat(50);
      expect(generateTitleFromMessage(content)).toBe(content);
    });

    it('handles content just over MAX_LENGTH with good break', () => {
      const content = 'Short words that together exceed fifty characters limit';
      const result = generateTitleFromMessage(content);
      expect(result.endsWith('...')).toBe(true);
    });

    it('handles empty content', () => {
      expect(generateTitleFromMessage('')).toBe('');
    });

    it('handles whitespace-only content', () => {
      expect(generateTitleFromMessage('   ')).toBe('');
    });
  });
});
