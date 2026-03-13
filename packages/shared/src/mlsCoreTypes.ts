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

/** MLS group metadata */
export interface MlsGroup {
  id: string;
  groupIdMls: string;
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

export interface MlsKeyPackageShape<TBytes> {
  id: string;
  userId: string;
  keyPackageData: TBytes;
  keyPackageRef: string;
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  consumed: boolean;
}

export interface UploadMlsKeyPackagesRequestShape<TBytes> {
  keyPackages: Array<{
    keyPackageData: TBytes;
    keyPackageRef: string;
    cipherSuite: MlsCipherSuite;
  }>;
}

export interface UploadMlsKeyPackagesResponseShape<TBytes> {
  keyPackages: Array<MlsKeyPackageShape<TBytes>>;
}

export interface MlsKeyPackagesResponseShape<TBytes> {
  keyPackages: Array<MlsKeyPackageShape<TBytes>>;
}

export interface AddMlsMemberRequestShape<TBytes> {
  userId: string;
  commit: TBytes;
  welcome: TBytes;
  keyPackageRef: string;
  newEpoch: number;
}

export interface AddMlsMemberResponseShape {
  member: MlsGroupMember;
}

export interface MlsGroupMembersResponseShape {
  members: MlsGroupMember[];
}

export interface RemoveMlsMemberRequestShape<TBytes> {
  commit: TBytes;
  newEpoch: number;
}

/** MLS encrypted message (server only stores ciphertext) */
export interface MlsMessageShape<TBytes> {
  id: string;
  groupId: string;
  senderUserId: string | null;
  senderEmail?: string;
  epoch: number;
  ciphertext: TBytes;
  messageType: MlsMessageType;
  contentType: string;
  sequenceNumber: number;
  sentAt: string;
  createdAt: string;
}

export interface SendMlsMessageRequestShape<TBytes> {
  ciphertext: TBytes;
  epoch: number;
  messageType: MlsMessageType;
  contentType?: string;
}

export interface SendMlsMessageResponseShape<TBytes> {
  message: MlsMessageShape<TBytes>;
}

export interface MlsMessagesResponseShape<TBytes> {
  messages: Array<MlsMessageShape<TBytes>>;
  hasMore: boolean;
  cursor?: string;
}

/** MLS welcome message for joining a group */
export interface MlsWelcomeMessageShape<TBytes> {
  id: string;
  groupId: string;
  groupName: string;
  welcome: TBytes;
  keyPackageRef: string;
  epoch: number;
  createdAt: string;
}

export interface MlsWelcomeMessagesResponseShape<TBytes> {
  welcomes: Array<MlsWelcomeMessageShape<TBytes>>;
}

/** MLS group state snapshot for multi-device sync */
export interface MlsGroupStateShape<TBytes> {
  id: string;
  groupId: string;
  epoch: number;
  encryptedState: TBytes;
  stateHash: string;
  createdAt: string;
}

export interface UploadMlsStateRequestShape<TBytes> {
  epoch: number;
  encryptedState: TBytes;
  stateHash: string;
}

export interface UploadMlsStateResponseShape<TBytes> {
  state: MlsGroupStateShape<TBytes>;
}

export interface MlsGroupStateResponseShape<TBytes> {
  state: MlsGroupStateShape<TBytes> | null;
}
