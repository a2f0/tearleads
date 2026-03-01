/**
 * UI-facing type definitions for MLS chat.
 * Core MLS protocol/storage types are exported from @tearleads/mls-core.
 */

/**
 * Decrypted message content after client-side decryption
 */
export interface DecryptedMessage {
  id: string;
  groupId: string;
  senderUserId: string | null;
  senderEmail?: string | undefined;
  plaintext: string;
  contentType: string;
  sentAt: Date;
  isOwnMessage: boolean;
}

/**
 * Group with local decryption capability
 */
export interface ActiveGroup {
  id: string;
  name: string;
  canDecrypt: boolean;
  memberCount: number;
  lastMessageAt?: Date | undefined;
  unreadCount: number;
}

/**
 * SSE connection state
 */
export type SseConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';
