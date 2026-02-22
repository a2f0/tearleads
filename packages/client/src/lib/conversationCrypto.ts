/**
 * Conversation encryption utilities.
 *
 * Uses the same VFS key pattern for encrypting conversation titles and messages.
 * Session keys are wrapped with the user's VFS public key for server storage.
 */

import type {
  AiConversation,
  AiMessage,
  DecryptedAiConversation,
  DecryptedAiMessage
} from '@tearleads/shared';
import {
  decrypt,
  encrypt,
  importKey,
  splitEncapsulation,
  unwrapKeyWithKeyPair
} from '@tearleads/shared';
import { ensureVfsKeys, generateSessionKey, wrapSessionKey } from '@/hooks/vfs';

/**
 * Convert a base64 string to Uint8Array.
 */
function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Convert a Uint8Array to base64 string.
 */
function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encrypt text content with a session key.
 * Returns base64-encoded ciphertext.
 */
export async function encryptContent(
  content: string,
  sessionKey: Uint8Array
): Promise<string> {
  const plaintext = new TextEncoder().encode(content);
  const cryptoKey = await importKey(sessionKey);
  const ciphertext = await encrypt(plaintext, cryptoKey);
  return toBase64(ciphertext);
}

/**
 * Decrypt text content with a session key.
 * Takes base64-encoded ciphertext, returns plaintext string.
 */
export async function decryptContent(
  encryptedContent: string,
  sessionKey: Uint8Array
): Promise<string> {
  const ciphertext = fromBase64(encryptedContent);
  const cryptoKey = await importKey(sessionKey);
  const plaintext = await decrypt(ciphertext, cryptoKey);
  return new TextDecoder().decode(plaintext);
}

/**
 * Unwrap a session key using the user's VFS keypair.
 * The encapsulated key is stored in the conversation's encryptedSessionKey field.
 */
export async function unwrapConversationSessionKey(
  encryptedSessionKey: string,
  keyPair: {
    x25519PublicKey: Uint8Array;
    x25519PrivateKey: Uint8Array;
    mlKemPublicKey: Uint8Array;
    mlKemPrivateKey: Uint8Array;
  }
): Promise<Uint8Array> {
  const encapsulation = splitEncapsulation(encryptedSessionKey);
  return unwrapKeyWithKeyPair(encapsulation, keyPair);
}

/**
 * Create encryption data for a new conversation.
 * Generates a session key and wraps it with the user's VFS public key.
 */
export async function createConversationEncryption(title: string): Promise<{
  encryptedTitle: string;
  encryptedSessionKey: string;
  sessionKey: Uint8Array;
}> {
  await ensureVfsKeys();
  const sessionKey = generateSessionKey();
  const encryptedSessionKey = await wrapSessionKey(sessionKey);
  const encryptedTitle = await encryptContent(title, sessionKey);

  return {
    encryptedTitle,
    encryptedSessionKey,
    sessionKey
  };
}

/**
 * Encrypt a message for a conversation.
 */
export async function encryptMessage(
  content: string,
  sessionKey: Uint8Array
): Promise<string> {
  return encryptContent(content, sessionKey);
}

/**
 * Decrypt a conversation using a session key.
 */
export async function decryptConversation(
  conversation: AiConversation,
  sessionKey: Uint8Array
): Promise<DecryptedAiConversation> {
  const title = await decryptContent(conversation.encryptedTitle, sessionKey);

  return {
    id: conversation.id,
    userId: conversation.userId,
    organizationId: conversation.organizationId,
    title,
    modelId: conversation.modelId,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

/**
 * Decrypt a message using a session key.
 */
async function decryptMessage(
  message: AiMessage,
  sessionKey: Uint8Array
): Promise<DecryptedAiMessage> {
  const content = await decryptContent(message.encryptedContent, sessionKey);

  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content,
    modelId: message.modelId,
    sequenceNumber: message.sequenceNumber,
    createdAt: message.createdAt
  };
}

/**
 * Decrypt all messages in a list.
 */
export async function decryptMessages(
  messages: AiMessage[],
  sessionKey: Uint8Array
): Promise<DecryptedAiMessage[]> {
  return Promise.all(messages.map((msg) => decryptMessage(msg, sessionKey)));
}

/**
 * Encrypt a new title for an existing conversation.
 */
export async function encryptTitle(
  title: string,
  sessionKey: Uint8Array
): Promise<string> {
  return encryptContent(title, sessionKey);
}

/**
 * Generate a title from the first message content.
 * Truncates to a reasonable length and adds ellipsis if needed.
 */
export function generateTitleFromMessage(content: string): string {
  const MAX_LENGTH = 50;
  const trimmed = content.trim().replace(/\n/g, ' ');

  if (trimmed.length <= MAX_LENGTH) {
    return trimmed;
  }

  // Find a good break point at the last word boundary before MAX_LENGTH
  const breakPoint = trimmed.lastIndexOf(' ', MAX_LENGTH);
  if (breakPoint > 0) {
    return `${trimmed.slice(0, breakPoint)}...`;
  }

  return `${trimmed.slice(0, MAX_LENGTH)}...`;
}
