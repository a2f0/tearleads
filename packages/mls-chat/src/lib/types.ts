/**
 * Internal type definitions for MLS chat.
 * Public types are exported from @tearleads/shared.
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
 * Local MLS state stored in IndexedDB
 */
export interface LocalMlsState {
  groupId: string;
  serializedState: Uint8Array;
  epoch: number;
  updatedAt: number;
}

/**
 * MLS credential stored locally
 */
export interface MlsCredential {
  credentialBundle: Uint8Array;
  privateKey: Uint8Array;
  userId: string;
  createdAt: number;
}

/**
 * Unused key package with private key
 */
export interface LocalKeyPackage {
  ref: string;
  keyPackage: Uint8Array;
  privateKey: Uint8Array;
  createdAt: number;
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

