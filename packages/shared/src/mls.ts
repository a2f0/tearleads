/**
 * MLS (RFC 9420) Encrypted Chat Types
 *
 * Types for multi-user end-to-end encrypted chat using MLS protocol.
 * All encryption is client-side; the server only stores/relays encrypted data.
 */

// KeyPackage types - public keys for adding users to groups

export interface KeyPackageUpload {
  keyPackageData: string; // Base64-encoded KeyPackage
}

export interface KeyPackageResponse {
  id: string;
  keyPackageData: string; // Base64-encoded KeyPackage
}

export interface KeyPackageCountResponse {
  count: number;
}

// Group types

export interface ChatGroup {
  id: string;
  name: string;
  createdBy: string;
  mlsGroupId: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface ChatGroupMember {
  userId: string;
  email: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface CreateGroupRequest {
  name: string;
  mlsGroupId: string; // Base64-encoded, client generates MLS group
}

export interface CreateGroupResponse {
  group: ChatGroup;
}

export interface ChatGroupsResponse {
  groups: ChatGroup[];
}

export interface ChatGroupResponse {
  group: ChatGroup;
  members: ChatGroupMember[];
}

export interface AddMembersRequest {
  memberUserIds: string[];
  welcomeMessages: WelcomeMessage[];
  commitData: string; // Base64-encoded MLS commit
}

export interface WelcomeMessage {
  userId: string;
  welcomeData: string; // Base64-encoded Welcome
}

export interface AddMembersResponse {
  addedMembers: ChatGroupMember[];
}

export interface RemoveMemberResponse {
  removed: boolean;
}

// Message types

export interface MlsMessagePost {
  ciphertext: string; // Base64-encoded MLS ciphertext
  epoch: number; // MLS epoch for ordering
}

export interface MlsMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderEmail: string;
  ciphertext: string; // Base64-encoded
  epoch: number;
  createdAt: string;
}

export interface MlsMessagesResponse {
  messages: MlsMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface PostMlsMessageResponse {
  message: MlsMessage;
}

// Welcome types - for adding new members to groups

export interface PendingWelcome {
  id: string;
  groupId: string;
  groupName: string;
  welcomeData: string; // Base64-encoded
  createdAt: string;
}

export interface PendingWelcomesResponse {
  welcomes: PendingWelcome[];
}

// SSE Broadcast types for real-time updates

export interface MlsMessageBroadcast {
  type: 'mls_message';
  payload: MlsMessage;
  timestamp: string;
}

export interface MlsWelcomeBroadcast {
  type: 'mls_welcome';
  payload: {
    groupId: string;
    groupName: string;
  };
  timestamp: string;
}

export interface MlsMemberAddedBroadcast {
  type: 'mls_member_added';
  payload: {
    groupId: string;
    member: ChatGroupMember;
  };
  timestamp: string;
}

export interface MlsMemberRemovedBroadcast {
  type: 'mls_member_removed';
  payload: {
    groupId: string;
    userId: string;
  };
  timestamp: string;
}

export type MlsBroadcast =
  | MlsMessageBroadcast
  | MlsWelcomeBroadcast
  | MlsMemberAddedBroadcast
  | MlsMemberRemovedBroadcast;

// Type guards

export function isMlsMessageBroadcast(
  value: unknown
): value is MlsMessageBroadcast {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'mls_message'
  );
}

export function isMlsWelcomeBroadcast(
  value: unknown
): value is MlsWelcomeBroadcast {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'mls_welcome'
  );
}

export function isMlsBroadcast(value: unknown): value is MlsBroadcast {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  return (
    type === 'mls_message' ||
    type === 'mls_welcome' ||
    type === 'mls_member_added' ||
    type === 'mls_member_removed'
  );
}
