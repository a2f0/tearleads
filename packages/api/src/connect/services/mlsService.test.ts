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

describe('mlsConnectServiceV2', () => {
  beforeEach(() => {
    const allMocks = [
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
    ];

    for (const mockFn of allMocks) {
      mockFn.mockReset();
    }
  });

  it('converts typed key package request and maps typed response', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      keyPackages: [
        {
          id: 'kp-1',
          userId: 'u-1',
          keyPackageData: base64('data'),
          keyPackageRef: 'ref',
          cipherSuite: 3,
          createdAt: '2024-01-01T00:00:00Z',
          consumed: false
        }
      ]
    });

    const result = await mlsConnectServiceV2.uploadKeyPackages(
      {
        keyPackages: [
          {
            keyPackageData: bytes('data'),
            keyPackageRef: 'ref',
            cipherSuite: 3
          }
        ]
      },
      context
    );

    expect(result.keyPackages).toHaveLength(1);
    expect(result.keyPackages[0]?.id).toBe('kp-1');
    expect(uploadKeyPackagesDirectMock).toHaveBeenCalledWith(
      {
        keyPackages: [
          {
            keyPackageData: base64('data'),
            keyPackageRef: 'ref',
            cipherSuite: 3
          }
        ]
      },
      context
    );
    expect(result.keyPackages[0]?.keyPackageData).toEqual(bytes('data'));
  });

  it('converts typed create group request and maps typed response', async () => {
    const context = createContext();
    createGroupDirectMock.mockResolvedValue({
      group: {
        id: 'g-1',
        groupIdMls: 'mls-1',
        name: 'Test',
        description: null,
        creatorUserId: 'u-1',
        currentEpoch: 0,
        cipherSuite: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    const result = await mlsConnectServiceV2.createGroup(
      { name: 'Test', description: '', groupIdMls: 'mls-1', cipherSuite: 3 },
      context
    );

    expect(result.group?.name).toBe('Test');
    expect(result.group?.id).toBe('g-1');
    expect(createGroupDirectMock).toHaveBeenCalledWith(
      {
        name: 'Test',
        description: undefined,
        groupIdMls: 'mls-1',
        cipherSuite: 3
      },
      context
    );
  });

  it('passes non-empty description to typed create group direct handler', async () => {
    const context = createContext();
    createGroupDirectMock.mockResolvedValue({
      group: {
        id: 'g-2',
        groupIdMls: 'mls-2',
        name: 'Named',
        description: 'desc',
        creatorUserId: 'u-1',
        currentEpoch: 0,
        cipherSuite: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    await mlsConnectServiceV2.createGroup(
      {
        name: 'Named',
        description: 'desc',
        groupIdMls: 'mls-2',
        cipherSuite: 3
      },
      context
    );

    expect(createGroupDirectMock).toHaveBeenCalledWith(
      {
        name: 'Named',
        description: 'desc',
        groupIdMls: 'mls-2',
        cipherSuite: 3
      },
      context
    );
  });

  it('converts list groups response to typed proto fields', async () => {
    const context = createContext();
    listGroupsDirectMock.mockResolvedValue({
      groups: [
        {
          id: 'g-1',
          groupIdMls: 'mls-1',
          name: 'Group 1',
          description: null,
          creatorUserId: 'u-1',
          currentEpoch: 5,
          cipherSuite: 3,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          memberCount: 3,
          role: 'admin'
        }
      ]
    });

    const result = await mlsConnectServiceV2.listGroups({}, context);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.currentEpoch).toBe(BigInt(5));
    expect(result.groups[0]?.role).toBe(1); // ADMIN enum value
  });

  it('propagates direct typed errors', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockRejectedValue(new Error('typed failure'));

    await expect(
      mlsConnectServiceV2.uploadKeyPackages({ keyPackages: [] }, context)
    ).rejects.toThrow('typed failure');
  });

  it('returns empty response for delete operations', async () => {
    const context = createContext();
    deleteKeyPackageDirectMock.mockResolvedValue({});

    const result = await mlsConnectServiceV2.deleteKeyPackage(
      { id: 'kp-1' },
      context
    );

    expect(result).toEqual({});
    expect(deleteKeyPackageDirectMock).toHaveBeenCalledWith(
      { id: 'kp-1' },
      context
    );
  });

  it('omits empty update fields and delegates deleteGroup', async () => {
    const context = createContext();
    updateGroupDirectMock.mockResolvedValue({
      group: {
        id: 'g-1',
        groupIdMls: 'mls-1',
        name: 'Same',
        description: null,
        creatorUserId: 'u-1',
        currentEpoch: 2,
        cipherSuite: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z'
      }
    });
    deleteGroupDirectMock.mockResolvedValue({});

    await mlsConnectServiceV2.updateGroup(
      { groupId: 'g-1', name: '', description: '' },
      context
    );
    const deleteResult = await mlsConnectServiceV2.deleteGroup(
      { groupId: 'g-1' },
      context
    );

    expect(updateGroupDirectMock).toHaveBeenCalledWith(
      { groupId: 'g-1' },
      context
    );
    expect(deleteGroupDirectMock).toHaveBeenCalledWith(
      { groupId: 'g-1' },
      context
    );
    expect(deleteResult).toEqual({});
  });
});
