import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acknowledgeWelcomeDirectMock,
  addGroupMemberDirectMock,
  createGroupDirectMock,
  deleteGroupDirectMock,
  deleteKeyPackageDirectMock,
  getGroupDirectMock,
  getGroupMembersDirectMock,
  getGroupMessagesDirectMock,
  getGroupStateDirectMock,
  getMyKeyPackagesDirectMock,
  getUserKeyPackagesDirectMock,
  getWelcomeMessagesDirectMock,
  listGroupsDirectMock,
  removeGroupMemberDirectMock,
  sendGroupMessageDirectMock,
  updateGroupDirectMock,
  uploadGroupStateDirectMock,
  uploadKeyPackagesDirectMock
} = vi.hoisted(() => ({
  acknowledgeWelcomeDirectMock: vi.fn(),
  addGroupMemberDirectMock: vi.fn(),
  createGroupDirectMock: vi.fn(),
  deleteGroupDirectMock: vi.fn(),
  deleteKeyPackageDirectMock: vi.fn(),
  getGroupDirectMock: vi.fn(),
  getGroupMembersDirectMock: vi.fn(),
  getGroupMessagesDirectMock: vi.fn(),
  getGroupStateDirectMock: vi.fn(),
  getMyKeyPackagesDirectMock: vi.fn(),
  getUserKeyPackagesDirectMock: vi.fn(),
  getWelcomeMessagesDirectMock: vi.fn(),
  listGroupsDirectMock: vi.fn(),
  removeGroupMemberDirectMock: vi.fn(),
  sendGroupMessageDirectMock: vi.fn(),
  updateGroupDirectMock: vi.fn(),
  uploadGroupStateDirectMock: vi.fn(),
  uploadKeyPackagesDirectMock: vi.fn()
}));

vi.mock('./mlsDirectKeyPackages.js', () => ({
  uploadKeyPackagesDirectTyped: (...args: unknown[]) =>
    uploadKeyPackagesDirectMock(...args),
  getMyKeyPackagesDirectTyped: (...args: unknown[]) =>
    getMyKeyPackagesDirectMock(...args),
  getUserKeyPackagesDirectTyped: (...args: unknown[]) =>
    getUserKeyPackagesDirectMock(...args),
  deleteKeyPackageDirectTyped: (...args: unknown[]) =>
    deleteKeyPackageDirectMock(...args),
  uploadKeyPackagesDirect: (...args: unknown[]) =>
    uploadKeyPackagesDirectMock(...args),
  getMyKeyPackagesDirect: (...args: unknown[]) =>
    getMyKeyPackagesDirectMock(...args),
  getUserKeyPackagesDirect: (...args: unknown[]) =>
    getUserKeyPackagesDirectMock(...args),
  deleteKeyPackageDirect: (...args: unknown[]) =>
    deleteKeyPackageDirectMock(...args)
}));

vi.mock('./mlsDirectGroups.js', () => ({
  createGroupDirectTyped: (...args: unknown[]) =>
    createGroupDirectMock(...args),
  listGroupsDirectTyped: (...args: unknown[]) => listGroupsDirectMock(...args),
  getGroupDirectTyped: (...args: unknown[]) => getGroupDirectMock(...args),
  updateGroupDirectTyped: (...args: unknown[]) =>
    updateGroupDirectMock(...args),
  deleteGroupDirectTyped: (...args: unknown[]) =>
    deleteGroupDirectMock(...args),
  createGroupDirect: (...args: unknown[]) => createGroupDirectMock(...args),
  listGroupsDirect: (...args: unknown[]) => listGroupsDirectMock(...args),
  getGroupDirect: (...args: unknown[]) => getGroupDirectMock(...args),
  updateGroupDirect: (...args: unknown[]) => updateGroupDirectMock(...args),
  deleteGroupDirect: (...args: unknown[]) => deleteGroupDirectMock(...args)
}));

vi.mock('./mlsDirectGroupMembers.js', () => ({
  addGroupMemberDirect: (...args: unknown[]) =>
    addGroupMemberDirectMock(...args),
  addGroupMemberDirectTyped: (...args: unknown[]) =>
    addGroupMemberDirectMock(...args),
  getGroupMembersDirect: (...args: unknown[]) =>
    getGroupMembersDirectMock(...args),
  getGroupMembersDirectTyped: (...args: unknown[]) =>
    getGroupMembersDirectMock(...args),
  removeGroupMemberDirect: (...args: unknown[]) =>
    removeGroupMemberDirectMock(...args),
  removeGroupMemberDirectTyped: (...args: unknown[]) =>
    removeGroupMemberDirectMock(...args)
}));

vi.mock('./mlsDirectMessages.js', () => ({
  sendGroupMessageDirect: (...args: unknown[]) =>
    sendGroupMessageDirectMock(...args),
  sendGroupMessageDirectTyped: (...args: unknown[]) =>
    sendGroupMessageDirectMock(...args),
  getGroupMessagesDirect: (...args: unknown[]) =>
    getGroupMessagesDirectMock(...args),
  getGroupMessagesDirectTyped: (...args: unknown[]) =>
    getGroupMessagesDirectMock(...args)
}));

vi.mock('./mlsDirectState.js', () => ({
  getGroupStateDirect: (...args: unknown[]) => getGroupStateDirectMock(...args),
  getGroupStateDirectTyped: (...args: unknown[]) =>
    getGroupStateDirectMock(...args),
  uploadGroupStateDirect: (...args: unknown[]) =>
    uploadGroupStateDirectMock(...args),
  uploadGroupStateDirectTyped: (...args: unknown[]) =>
    uploadGroupStateDirectMock(...args)
}));

vi.mock('./mlsDirectWelcomeMessages.js', () => ({
  getWelcomeMessagesDirect: (...args: unknown[]) =>
    getWelcomeMessagesDirectMock(...args),
  getWelcomeMessagesDirectTyped: (...args: unknown[]) =>
    getWelcomeMessagesDirectMock(...args),
  acknowledgeWelcomeDirect: (...args: unknown[]) =>
    acknowledgeWelcomeDirectMock(...args),
  acknowledgeWelcomeDirectTyped: (...args: unknown[]) =>
    acknowledgeWelcomeDirectMock(...args)
}));

import { mlsConnectServiceV2 } from './mlsService.js';

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

describe('mlsConnectServiceV2 coverage', () => {
  beforeEach(() => {
    for (const mock of [
      acknowledgeWelcomeDirectMock,
      addGroupMemberDirectMock,
      createGroupDirectMock,
      deleteGroupDirectMock,
      deleteKeyPackageDirectMock,
      getGroupDirectMock,
      getGroupMembersDirectMock,
      getGroupMessagesDirectMock,
      getGroupStateDirectMock,
      getMyKeyPackagesDirectMock,
      getUserKeyPackagesDirectMock,
      getWelcomeMessagesDirectMock,
      listGroupsDirectMock,
      removeGroupMemberDirectMock,
      sendGroupMessageDirectMock,
      updateGroupDirectMock,
      uploadGroupStateDirectMock,
      uploadKeyPackagesDirectMock
    ]) {
      mock.mockReset();
    }
  });

  it('returns empty when getGroupState has null state', async () => {
    const context = createContext();
    getGroupStateDirectMock.mockResolvedValue({ state: null });

    const result = await mlsConnectServiceV2.getGroupState(
      { groupId: 'g-1' },
      context
    );

    expect(result).toEqual({});
  });

  it('converts getGroupState with state present', async () => {
    const context = createContext();
    getGroupStateDirectMock.mockResolvedValue({
      state: {
        id: 'st-1',
        groupId: 'g-1',
        epoch: 3,
        encryptedState: base64('enc'),
        stateHash: 'hash',
        createdAt: '2024-01-01T00:00:00Z'
      }
    });

    const result = await mlsConnectServiceV2.getGroupState(
      { groupId: 'g-1' },
      context
    );

    expect(result.state?.id).toBe('st-1');
    expect(result.state?.epoch).toBe(BigInt(3));
  });

  it('converts sendGroupMessage with typed fields', async () => {
    const context = createContext();
    sendGroupMessageDirectMock.mockResolvedValue({
      message: {
        id: 'msg-1',
        groupId: 'g-1',
        senderUserId: 'u-1',
        senderEmail: 'test@example.com',
        epoch: 2,
        ciphertext: base64('ct'),
        messageType: 'application',
        contentType: 'text/plain',
        sequenceNumber: 5,
        sentAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z'
      }
    });

    const result = await mlsConnectServiceV2.sendGroupMessage(
      {
        groupId: 'g-1',
        ciphertext: bytes('ct'),
        epoch: BigInt(2),
        messageType: 1,
        contentType: 'text/plain'
      },
      context
    );

    expect(result.message?.id).toBe('msg-1');
    expect(result.message?.epoch).toBe(BigInt(2));
  });

  it('converts getGroupMembers response', async () => {
    const context = createContext();
    getGroupMembersDirectMock.mockResolvedValue({
      members: [
        {
          userId: 'u-1',
          email: 'test@example.com',
          leafIndex: 0,
          role: 'member',
          joinedAt: '2024-01-01T00:00:00Z',
          joinedAtEpoch: 1
        }
      ]
    });

    const result = await mlsConnectServiceV2.getGroupMembers(
      { groupId: 'g-1' },
      context
    );

    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.userId).toBe('u-1');
  });

  it('converts acknowledgeWelcome request', async () => {
    const context = createContext();
    acknowledgeWelcomeDirectMock.mockResolvedValue({ acknowledged: true });

    const result = await mlsConnectServiceV2.acknowledgeWelcome(
      { id: 'w-1', groupId: 'g-1' },
      context
    );

    expect(result).toEqual({});
    expect(acknowledgeWelcomeDirectMock).toHaveBeenCalledWith(
      { id: 'w-1', groupId: 'g-1' },
      context
    );
  });

  it('converts getGroupMessages with pagination', async () => {
    const context = createContext();
    getGroupMessagesDirectMock.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          groupId: 'g-1',
          senderUserId: null,
          epoch: 1,
          ciphertext: base64('ct'),
          messageType: 'commit',
          contentType: '',
          sequenceNumber: 1,
          sentAt: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z'
        }
      ],
      hasMore: true,
      cursor: 'next-cursor'
    });

    const result = await mlsConnectServiceV2.getGroupMessages(
      { groupId: 'g-1', cursor: '', limit: 10 },
      context
    );

    expect(result.messages).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('next-cursor');
  });

  it('converts getGroup response with members', async () => {
    const context = createContext();
    getGroupDirectMock.mockResolvedValue({
      group: {
        id: 'g-1',
        groupIdMls: 'mls-1',
        name: 'Test',
        description: null,
        creatorUserId: 'u-1',
        currentEpoch: 2,
        cipherSuite: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: [
        {
          userId: 'u-1',
          email: 'test@example.com',
          leafIndex: null,
          role: 'admin',
          joinedAt: '2024-01-01T00:00:00Z',
          joinedAtEpoch: 0
        }
      ]
    });

    const result = await mlsConnectServiceV2.getGroup(
      { groupId: 'g-1' },
      context
    );

    expect(result.group?.name).toBe('Test');
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.role).toBe(1);
  });

  it('converts uploadGroupState with typed fields', async () => {
    const context = createContext();
    uploadGroupStateDirectMock.mockResolvedValue({
      state: {
        id: 'st-1',
        groupId: 'g-1',
        epoch: 5,
        encryptedState: base64('enc'),
        stateHash: 'hash',
        createdAt: '2024-01-01T00:00:00Z'
      }
    });

    const result = await mlsConnectServiceV2.uploadGroupState(
      {
        groupId: 'g-1',
        epoch: BigInt(5),
        encryptedState: bytes('enc'),
        stateHash: 'hash'
      },
      context
    );

    expect(result.state?.epoch).toBe(BigInt(5));
  });

  it('converts addGroupMember with typed fields', async () => {
    const context = createContext();
    addGroupMemberDirectMock.mockResolvedValue({
      member: {
        userId: 'u-2',
        email: 'user2@example.com',
        leafIndex: 1,
        role: 'member',
        joinedAt: '2024-01-01T00:00:00Z',
        joinedAtEpoch: 3
      }
    });

    const result = await mlsConnectServiceV2.addGroupMember(
      {
        groupId: 'g-1',
        userId: 'u-2',
        commit: bytes('commit-data'),
        welcome: bytes('welcome-data'),
        keyPackageRef: 'ref',
        newEpoch: BigInt(3)
      },
      context
    );

    expect(result.member?.userId).toBe('u-2');
  });

  it('converts removeGroupMember request', async () => {
    const context = createContext();
    removeGroupMemberDirectMock.mockResolvedValue({});

    const result = await mlsConnectServiceV2.removeGroupMember(
      {
        groupId: 'g-1',
        userId: 'u-2',
        commit: bytes('commit-data'),
        newEpoch: BigInt(4)
      },
      context
    );

    expect(result).toEqual({});
  });

  it('converts updateGroup with typed fields', async () => {
    const context = createContext();
    updateGroupDirectMock.mockResolvedValue({
      group: {
        id: 'g-1',
        groupIdMls: 'mls-1',
        name: 'Updated',
        description: 'desc',
        creatorUserId: 'u-1',
        currentEpoch: 2,
        cipherSuite: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z'
      }
    });

    const result = await mlsConnectServiceV2.updateGroup(
      { groupId: 'g-1', name: 'Updated', description: 'desc' },
      context
    );

    expect(result.group?.name).toBe('Updated');
  });

  it('converts getMyKeyPackages response', async () => {
    const context = createContext();
    getMyKeyPackagesDirectMock.mockResolvedValue({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'u-1',
          keyPackageData: 'data',
          keyPackageRef: 'ref',
          cipherSuite: 1,
          createdAt: '2024-01-01T00:00:00Z',
          consumed: false
        }
      ]
    });

    const result = await mlsConnectServiceV2.getMyKeyPackages({}, context);

    expect(result.keyPackages).toHaveLength(1);
    expect(result.keyPackages[0]?.cipherSuite).toBe(1);
  });

  it('converts getUserKeyPackages response', async () => {
    const context = createContext();
    getUserKeyPackagesDirectMock.mockResolvedValue({
      keyPackages: [
        {
          id: 'kp-2',
          userId: 'u-2',
          keyPackageData: 'data2',
          keyPackageRef: 'ref2',
          cipherSuite: 65535,
          createdAt: '2024-01-01T00:00:00Z',
          consumed: true
        }
      ]
    });

    const result = await mlsConnectServiceV2.getUserKeyPackages(
      { userId: 'u-2' },
      context
    );

    expect(result.keyPackages).toHaveLength(1);
    expect(result.keyPackages[0]?.cipherSuite).toBe(65535);
  });
});
