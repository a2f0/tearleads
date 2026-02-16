// =============================================================================
// MLS (RFC 9420) Encrypted Chat Types
// =============================================================================

/** MLS ciphersuites - X-Wing hybrid (ML-KEM + X25519) for post-quantum security */
export const MLS_CIPHERSUITES = {
  /** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 */
  X25519_AES128GCM: 1,
  /** MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519 */
  X25519_CHACHA20_SHA256_ED25519: 3,
  /** X-Wing hybrid: ML-KEM-768 + X25519 for post-quantum security */
  XWING_HYBRID: 65535
} as const;

export type MlsCipherSuite =
  (typeof MLS_CIPHERSUITES)[keyof typeof MLS_CIPHERSUITES];

/** MLS key package stored on server */
export interface MlsKeyPackage {
  id: string;
  userId: string;
  keyPackageData: string; // base64
  keyPackageRef: string; // base64 hash
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  consumed: boolean;
}

/** MLS group metadata */
export interface MlsGroup {
  id: string;
  groupIdMls: string; // base64 MLS group ID
  name: string;
  description: string | null;
  creatorUserId: string;
  currentEpoch: number;
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  memberCount?: number;
  role?: MlsGroupRole;
}

export type MlsGroupRole = 'admin' | 'member';

/** MLS group member info */
export interface MlsGroupMember {
  userId: string;
  email: string;
  leafIndex: number | null;
  role: MlsGroupRole;
  joinedAt: string;
  joinedAtEpoch: number;
}

export type MlsMessageType = 'application' | 'commit' | 'proposal';

/** MLS encrypted message (server only stores ciphertext) */
export interface MlsMessage {
  id: string;
  groupId: string;
  senderUserId: string | null; // null if sender was deleted
  senderEmail?: string;
  epoch: number;
  ciphertext: string; // base64
  messageType: MlsMessageType;
  contentType: string;
  sequenceNumber: number;
  sentAt: string;
  createdAt: string;
}

/** MLS welcome message for joining a group */
export interface MlsWelcomeMessage {
  id: string;
  groupId: string;
  groupName: string;
  welcome: string; // base64 welcome data
  keyPackageRef: string; // reference to the key package used
  epoch: number;
  createdAt: string;
}

/** MLS group state snapshot for multi-device sync */
export interface MlsGroupState {
  id: string;
  groupId: string;
  epoch: number;
  encryptedState: string; // base64, encrypted client-side
  stateHash: string;
  createdAt: string;
}

// MLS API Request/Response types

export interface UploadMlsKeyPackagesRequest {
  keyPackages: Array<{
    keyPackageData: string;
    keyPackageRef: string;
    cipherSuite: MlsCipherSuite;
  }>;
}

export interface UploadMlsKeyPackagesResponse {
  keyPackages: MlsKeyPackage[];
}

export interface MlsKeyPackagesResponse {
  keyPackages: MlsKeyPackage[];
}

export interface CreateMlsGroupRequest {
  name: string;
  description?: string;
  groupIdMls: string;
  cipherSuite: MlsCipherSuite;
}

export interface CreateMlsGroupResponse {
  group: MlsGroup;
}

export interface MlsGroupsResponse {
  groups: MlsGroup[];
}

export interface MlsGroupResponse {
  group: MlsGroup;
  members: MlsGroupMember[];
}

export interface UpdateMlsGroupRequest {
  name?: string;
  description?: string;
}

export interface AddMlsMemberRequest {
  userId: string;
  commit: string; // base64 MLS commit
  welcome: string; // base64 MLS welcome
  keyPackageRef: string;
  newEpoch: number;
}

export interface AddMlsMemberResponse {
  member: MlsGroupMember;
}

export interface RemoveMlsMemberRequest {
  commit: string; // base64 MLS commit
  newEpoch: number;
}

export interface MlsGroupMembersResponse {
  members: MlsGroupMember[];
}

export interface SendMlsMessageRequest {
  ciphertext: string; // base64
  epoch: number;
  messageType: MlsMessageType;
  contentType?: string;
}

export interface SendMlsMessageResponse {
  message: MlsMessage;
}

export interface MlsMessagesResponse {
  messages: MlsMessage[];
  hasMore: boolean;
  cursor?: string;
}

export interface MlsWelcomeMessagesResponse {
  welcomes: MlsWelcomeMessage[];
}

export interface AckMlsWelcomeRequest {
  groupId: string;
}

export interface UploadMlsStateRequest {
  epoch: number;
  encryptedState: string;
  stateHash: string;
}

export interface UploadMlsStateResponse {
  state: MlsGroupState;
}

export interface MlsGroupStateResponse {
  state: MlsGroupState | null;
}

/** SSE message types for MLS real-time */
export type MlsSseMessageType =
  | 'mls:message'
  | 'mls:commit'
  | 'mls:welcome'
  | 'mls:member_added'
  | 'mls:member_removed';

export interface MlsSsePayload {
  type: MlsSseMessageType;
  groupId: string;
  data: MlsMessage | MlsWelcomeMessage | MlsGroupMember;
}
