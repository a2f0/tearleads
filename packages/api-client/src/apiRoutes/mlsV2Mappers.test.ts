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
import { describe, expect, it } from 'vitest';
import {
  mapGroupInfoToMlsGroup,
  mapGroupStateInfoToMlsGroupState,
  mapKeyPackageEntryToMlsKeyPackage,
  mapMemberInfoToGroupMember,
  mapMessageInfoToMlsMessage,
  mapWelcomeInfoToMlsWelcomeMessage,
  toProtoCipherSuite,
  toProtoMessageType
} from './mlsV2Mappers';

describe('toProtoCipherSuite', () => {
  it('maps known cipher suite values', () => {
    expect(toProtoCipherSuite(1)).toBe(MlsCipherSuite.X25519_AES128GCM);
    expect(toProtoCipherSuite(3)).toBe(MlsCipherSuite.X25519_CHACHA20);
    expect(toProtoCipherSuite(65535)).toBe(MlsCipherSuite.XWING_HYBRID);
  });

  it('returns UNSPECIFIED for unknown values', () => {
    expect(toProtoCipherSuite(999)).toBe(MlsCipherSuite.UNSPECIFIED);
  });
});

describe('toProtoMessageType', () => {
  it('maps known message types', () => {
    expect(toProtoMessageType('application')).toBe(MlsMessageType.APPLICATION);
    expect(toProtoMessageType('commit')).toBe(MlsMessageType.COMMIT);
    expect(toProtoMessageType('proposal')).toBe(MlsMessageType.PROPOSAL);
  });

  it('returns UNSPECIFIED for unknown values', () => {
    expect(toProtoMessageType('unknown')).toBe(MlsMessageType.UNSPECIFIED);
  });
});

describe('mapKeyPackageEntryToMlsKeyPackage', () => {
  it('maps all fields', () => {
    const entry = {
      id: 'kp-1',
      userId: 'u-1',
      keyPackageData: 'data',
      keyPackageRef: 'ref',
      cipherSuite: MlsCipherSuite.X25519_CHACHA20,
      createdAt: '2024-01-01T00:00:00Z',
      consumed: false
    } as MlsKeyPackageEntry;

    const result = mapKeyPackageEntryToMlsKeyPackage(entry);

    expect(result.id).toBe('kp-1');
    expect(result.cipherSuite).toBe(3);
  });
});

describe('mapGroupInfoToMlsGroup', () => {
  it('maps group with optional fields', () => {
    const info = {
      id: 'g-1',
      groupIdMls: 'mls-1',
      name: 'Test',
      description: 'desc',
      creatorUserId: 'u-1',
      currentEpoch: BigInt(5),
      cipherSuite: MlsCipherSuite.X25519_CHACHA20,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastMessageAt: '2024-01-02T00:00:00Z',
      memberCount: 3,
      role: MlsGroupRole.ADMIN
    } as MlsGroupInfo;

    const result = mapGroupInfoToMlsGroup(info);

    expect(result.id).toBe('g-1');
    expect(result.currentEpoch).toBe(5);
    expect(result.lastMessageAt).toBe('2024-01-02T00:00:00Z');
    expect(result.memberCount).toBe(3);
    expect(result.role).toBe('admin');
  });

  it('handles missing optional fields', () => {
    const info = {
      id: 'g-2',
      groupIdMls: 'mls-2',
      name: 'Test',
      description: '',
      creatorUserId: 'u-1',
      currentEpoch: BigInt(0),
      cipherSuite: MlsCipherSuite.UNSPECIFIED,
      createdAt: '',
      updatedAt: '',
      lastMessageAt: '',
      memberCount: 0,
      role: MlsGroupRole.MEMBER
    } as MlsGroupInfo;

    const result = mapGroupInfoToMlsGroup(info);

    expect(result.lastMessageAt).toBeUndefined();
    expect(result.memberCount).toBeUndefined();
    expect(result.role).toBe('member');
  });
});

describe('mapMemberInfoToGroupMember', () => {
  it('maps member with leaf index', () => {
    const info = {
      userId: 'u-1',
      email: 'test@example.com',
      leafIndex: 3,
      leafIndexPresent: true,
      role: MlsGroupRole.ADMIN,
      joinedAt: '2024-01-01T00:00:00Z',
      joinedAtEpoch: BigInt(1)
    } as MlsGroupMemberInfo;

    const result = mapMemberInfoToGroupMember(info);

    expect(result.leafIndex).toBe(3);
    expect(result.role).toBe('admin');
    expect(result.joinedAtEpoch).toBe(1);
  });

  it('handles absent leaf index', () => {
    const info = {
      userId: 'u-1',
      email: 'test@example.com',
      leafIndex: 0,
      leafIndexPresent: false,
      role: MlsGroupRole.MEMBER,
      joinedAt: '',
      joinedAtEpoch: BigInt(0)
    } as MlsGroupMemberInfo;

    const result = mapMemberInfoToGroupMember(info);

    expect(result.leafIndex).toBeNull();
  });
});

describe('mapMessageInfoToMlsMessage', () => {
  it('maps message with sender email', () => {
    const info = {
      id: 'msg-1',
      groupId: 'g-1',
      senderUserId: 'u-1',
      senderEmail: 'test@example.com',
      epoch: BigInt(2),
      ciphertext: 'ct',
      messageType: MlsMessageType.APPLICATION,
      contentType: 'text/plain',
      sequenceNumber: BigInt(5),
      sentAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z'
    } as MlsMessageInfo;

    const result = mapMessageInfoToMlsMessage(info);

    expect(result.senderEmail).toBe('test@example.com');
    expect(result.messageType).toBe('application');
    expect(result.epoch).toBe(2);
    expect(result.sequenceNumber).toBe(5);
  });

  it('maps message without sender email', () => {
    const info = {
      id: 'msg-2',
      groupId: 'g-1',
      senderUserId: '',
      senderEmail: '',
      epoch: BigInt(1),
      ciphertext: 'ct',
      messageType: MlsMessageType.COMMIT,
      contentType: '',
      sequenceNumber: BigInt(1),
      sentAt: '',
      createdAt: ''
    } as MlsMessageInfo;

    const result = mapMessageInfoToMlsMessage(info);

    expect(result).not.toHaveProperty('senderEmail');
    expect(result.messageType).toBe('commit');
  });
});

describe('mapGroupStateInfoToMlsGroupState', () => {
  it('maps all fields', () => {
    const info = {
      id: 'st-1',
      groupId: 'g-1',
      epoch: BigInt(3),
      encryptedState: 'enc',
      stateHash: 'hash',
      createdAt: '2024-01-01T00:00:00Z'
    } as MlsGroupStateInfo;

    const result = mapGroupStateInfoToMlsGroupState(info);

    expect(result.epoch).toBe(3);
    expect(result.stateHash).toBe('hash');
  });
});

describe('mapWelcomeInfoToMlsWelcomeMessage', () => {
  it('maps all fields', () => {
    const info = {
      id: 'w-1',
      groupId: 'g-1',
      groupName: 'Group 1',
      welcome: 'welcome-data',
      keyPackageRef: 'ref',
      epoch: BigInt(0),
      createdAt: '2024-01-01T00:00:00Z'
    } as MlsWelcomeMessageInfo;

    const result = mapWelcomeInfoToMlsWelcomeMessage(info);

    expect(result.groupName).toBe('Group 1');
    expect(result.epoch).toBe(0);
  });
});
