import type {
  MlsGroup,
  MlsGroupMember,
  MlsGroupState,
  MlsKeyPackage,
  MlsMessage,
  MlsWelcomeMessage
} from '@tearleads/shared';
import type {
  MlsCipherSuite as ProtoCipherSuite,
  MlsGroupRole as ProtoGroupRole,
  MlsMessageType as ProtoMessageType
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import {
  MlsCipherSuite,
  MlsGroupRole,
  MlsMessageType
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';

// ---------------------------------------------------------------------------
// Enum converters
// ---------------------------------------------------------------------------

export function fromProtoCipherSuite(
  value: ProtoCipherSuite
): import('@tearleads/shared').MlsCipherSuite {
  switch (value) {
    case MlsCipherSuite.X25519_AES128GCM:
      return 1;
    case MlsCipherSuite.X25519_CHACHA20:
      return 3;
    case MlsCipherSuite.XWING_HYBRID:
      return 65535;
    default:
      return 3;
  }
}

export function toProtoCipherSuite(value: number): ProtoCipherSuite {
  switch (value) {
    case 1:
      return MlsCipherSuite.X25519_AES128GCM;
    case 3:
      return MlsCipherSuite.X25519_CHACHA20;
    case 65535:
      return MlsCipherSuite.XWING_HYBRID;
    default:
      return MlsCipherSuite.UNSPECIFIED;
  }
}

export function toProtoRole(value: string): ProtoGroupRole {
  switch (value) {
    case 'admin':
      return MlsGroupRole.ADMIN;
    case 'member':
      return MlsGroupRole.MEMBER;
    default:
      return MlsGroupRole.UNSPECIFIED;
  }
}

export function fromProtoMessageType(
  value: ProtoMessageType
): MlsMessage['messageType'] {
  switch (value) {
    case MlsMessageType.APPLICATION:
      return 'application';
    case MlsMessageType.COMMIT:
      return 'commit';
    case MlsMessageType.PROPOSAL:
      return 'proposal';
    default:
      return 'application';
  }
}

export function toProtoMessageType(value: string): ProtoMessageType {
  switch (value) {
    case 'application':
      return MlsMessageType.APPLICATION;
    case 'commit':
      return MlsMessageType.COMMIT;
    case 'proposal':
      return MlsMessageType.PROPOSAL;
    default:
      return MlsMessageType.UNSPECIFIED;
  }
}

// ---------------------------------------------------------------------------
// Response mappers (Direct typed models → proto typed fields)
// ---------------------------------------------------------------------------

export function toProtoKeyPackage(kp: MlsKeyPackage) {
  return {
    id: kp.id,
    userId: kp.userId,
    keyPackageData: kp.keyPackageData,
    keyPackageRef: kp.keyPackageRef,
    cipherSuite: toProtoCipherSuite(kp.cipherSuite),
    createdAt: kp.createdAt,
    consumed: kp.consumed
  };
}

export function toProtoGroup(g: MlsGroup) {
  return {
    id: g.id,
    groupIdMls: g.groupIdMls,
    name: g.name,
    description: g.description ?? '',
    creatorUserId: g.creatorUserId,
    currentEpoch: BigInt(g.currentEpoch),
    cipherSuite: toProtoCipherSuite(g.cipherSuite),
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    lastMessageAt: g.lastMessageAt ?? '',
    memberCount: g.memberCount ?? 0,
    role: toProtoRole(g.role ?? '')
  };
}

export function toProtoMember(m: MlsGroupMember) {
  return {
    userId: m.userId,
    email: m.email,
    leafIndex: m.leafIndex ?? 0,
    role: toProtoRole(m.role),
    joinedAt: m.joinedAt,
    joinedAtEpoch: BigInt(m.joinedAtEpoch),
    leafIndexPresent: m.leafIndex !== null
  };
}

export function toProtoMessage(msg: MlsMessage) {
  return {
    id: msg.id,
    groupId: msg.groupId,
    senderUserId: msg.senderUserId ?? '',
    senderEmail: msg.senderEmail ?? '',
    epoch: BigInt(msg.epoch),
    ciphertext: msg.ciphertext,
    messageType: toProtoMessageType(msg.messageType),
    contentType: msg.contentType,
    sequenceNumber: BigInt(msg.sequenceNumber),
    sentAt: msg.sentAt,
    createdAt: msg.createdAt
  };
}

export function toProtoGroupState(s: MlsGroupState) {
  return {
    id: s.id,
    groupId: s.groupId,
    epoch: BigInt(s.epoch),
    encryptedState: s.encryptedState,
    stateHash: s.stateHash,
    createdAt: s.createdAt
  };
}

export function toProtoWelcome(w: MlsWelcomeMessage) {
  return {
    id: w.id,
    groupId: w.groupId,
    groupName: w.groupName,
    welcome: w.welcome,
    keyPackageRef: w.keyPackageRef,
    epoch: BigInt(w.epoch),
    createdAt: w.createdAt
  };
}

// ---------------------------------------------------------------------------
// V2 typed request types (from generated proto)
// ---------------------------------------------------------------------------

export interface V2UploadKeyPackagesRequest {
  keyPackages: Array<{
    keyPackageData: Uint8Array;
    keyPackageRef: string;
    cipherSuite: ProtoCipherSuite;
  }>;
}

export interface V2CreateGroupRequest {
  name: string;
  description: string;
  groupIdMls: Uint8Array;
  cipherSuite: ProtoCipherSuite;
}

export interface V2UpdateGroupRequest {
  groupId: string;
  name: string;
  description: string;
}

export interface V2AddGroupMemberRequest {
  groupId: string;
  userId: string;
  commit: Uint8Array;
  welcome: Uint8Array;
  keyPackageRef: string;
  newEpoch: bigint;
}

export interface V2RemoveGroupMemberRequest {
  groupId: string;
  userId: string;
  commit: Uint8Array;
  newEpoch: bigint;
}

export interface V2SendGroupMessageRequest {
  groupId: string;
  ciphertext: Uint8Array;
  epoch: bigint;
  messageType: ProtoMessageType;
  contentType: string;
}

export interface V2UploadGroupStateRequest {
  groupId: string;
  epoch: bigint;
  encryptedState: Uint8Array;
  stateHash: string;
}

export interface V2AcknowledgeWelcomeRequest {
  id: string;
  groupId: string;
}
