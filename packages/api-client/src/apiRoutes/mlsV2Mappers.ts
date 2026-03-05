import type {
  MlsGroup,
  MlsGroupMember,
  MlsGroupState,
  MlsKeyPackage,
  MlsMessage,
  MlsWelcomeMessage
} from '@tearleads/shared';
import type {
  MlsGroupInfo,
  MlsGroupMemberInfo,
  MlsGroupStateInfo,
  MlsKeyPackageEntry,
  MlsMessageInfo,
  MlsWelcomeMessageInfo
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import {
  MlsCipherSuite,
  MlsGroupRole,
  MlsMessageType
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';

function bytesToBase64(value: Uint8Array | string): string {
  if (typeof value === 'string') {
    return value;
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < value.length; index += chunkSize) {
    binary += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Enum converters
// ---------------------------------------------------------------------------

export function toProtoCipherSuite(value: number): MlsCipherSuite {
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

function fromProtoCipherSuite(
  value: MlsCipherSuite
): import('@tearleads/shared').MlsCipherSuite {
  return value as number as import('@tearleads/shared').MlsCipherSuite;
}

function fromProtoRole(value: MlsGroupRole): string {
  switch (value) {
    case MlsGroupRole.ADMIN:
      return 'admin';
    case MlsGroupRole.MEMBER:
      return 'member';
    default:
      return 'member';
  }
}

function fromProtoMessageType(value: MlsMessageType): string {
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

export function toProtoMessageType(value: string): MlsMessageType {
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
// Proto → app-type mappers
// ---------------------------------------------------------------------------

export function mapKeyPackageEntryToMlsKeyPackage(
  entry: MlsKeyPackageEntry
): MlsKeyPackage {
  return {
    id: entry.id,
    userId: entry.userId,
    keyPackageData: entry.keyPackageData,
    keyPackageRef: entry.keyPackageRef,
    cipherSuite: fromProtoCipherSuite(entry.cipherSuite),
    createdAt: entry.createdAt,
    consumed: entry.consumed
  };
}

export function mapGroupInfoToMlsGroup(info: MlsGroupInfo): MlsGroup {
  const group: MlsGroup = {
    id: info.id,
    groupIdMls: info.groupIdMls,
    name: info.name,
    description: info.description || null,
    creatorUserId: info.creatorUserId,
    currentEpoch: Number(info.currentEpoch),
    cipherSuite: fromProtoCipherSuite(info.cipherSuite),
    createdAt: info.createdAt,
    updatedAt: info.updatedAt
  };
  if (info.lastMessageAt) {
    group.lastMessageAt = info.lastMessageAt;
  }
  if (info.memberCount > 0) {
    group.memberCount = info.memberCount;
  }
  const role = fromProtoRole(info.role);
  if (role === 'admin' || role === 'member') {
    group.role = role;
  }
  return group;
}

export function mapMemberInfoToGroupMember(
  info: MlsGroupMemberInfo
): MlsGroupMember {
  return {
    userId: info.userId,
    email: info.email,
    leafIndex: info.leafIndexPresent ? info.leafIndex : null,
    role: fromProtoRole(info.role) as MlsGroupMember['role'],
    joinedAt: info.joinedAt,
    joinedAtEpoch: Number(info.joinedAtEpoch)
  };
}

export function mapMessageInfoToMlsMessage(info: MlsMessageInfo): MlsMessage {
  const base = {
    id: info.id,
    groupId: info.groupId,
    senderUserId: info.senderUserId || null,
    epoch: Number(info.epoch),
    ciphertext: bytesToBase64(info.ciphertext),
    messageType: fromProtoMessageType(
      info.messageType
    ) as MlsMessage['messageType'],
    contentType: info.contentType,
    sequenceNumber: Number(info.sequenceNumber),
    sentAt: info.sentAt,
    createdAt: info.createdAt
  };
  if (info.senderEmail) {
    return { ...base, senderEmail: info.senderEmail };
  }
  return base;
}

export function mapGroupStateInfoToMlsGroupState(
  info: MlsGroupStateInfo
): MlsGroupState {
  return {
    id: info.id,
    groupId: info.groupId,
    epoch: Number(info.epoch),
    encryptedState: bytesToBase64(info.encryptedState),
    stateHash: info.stateHash,
    createdAt: info.createdAt
  };
}

export function mapWelcomeInfoToMlsWelcomeMessage(
  info: MlsWelcomeMessageInfo
): MlsWelcomeMessage {
  return {
    id: info.id,
    groupId: info.groupId,
    groupName: info.groupName,
    welcome: bytesToBase64(info.welcome),
    keyPackageRef: info.keyPackageRef,
    epoch: Number(info.epoch),
    createdAt: info.createdAt
  };
}
