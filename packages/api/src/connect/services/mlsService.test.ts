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
  createGroupDirect: (...args: unknown[]) => createGroupDirectMock(...args),
  listGroupsDirect: (...args: unknown[]) => listGroupsDirectMock(...args),
  getGroupDirect: (...args: unknown[]) => getGroupDirectMock(...args),
  updateGroupDirect: (...args: unknown[]) => updateGroupDirectMock(...args),
  deleteGroupDirect: (...args: unknown[]) => deleteGroupDirectMock(...args)
}));

vi.mock('./mlsDirectGroupMembers.js', () => ({
  addGroupMemberDirect: (...args: unknown[]) =>
    addGroupMemberDirectMock(...args),
  getGroupMembersDirect: (...args: unknown[]) =>
    getGroupMembersDirectMock(...args),
  removeGroupMemberDirect: (...args: unknown[]) =>
    removeGroupMemberDirectMock(...args)
}));

vi.mock('./mlsDirectMessages.js', () => ({
  sendGroupMessageDirect: (...args: unknown[]) =>
    sendGroupMessageDirectMock(...args),
  getGroupMessagesDirect: (...args: unknown[]) =>
    getGroupMessagesDirectMock(...args)
}));

vi.mock('./mlsDirectState.js', () => ({
  getGroupStateDirect: (...args: unknown[]) => getGroupStateDirectMock(...args),
  uploadGroupStateDirect: (...args: unknown[]) =>
    uploadGroupStateDirectMock(...args)
}));

vi.mock('./mlsDirectWelcomeMessages.js', () => ({
  getWelcomeMessagesDirect: (...args: unknown[]) =>
    getWelcomeMessagesDirectMock(...args),
  acknowledgeWelcomeDirect: (...args: unknown[]) =>
    acknowledgeWelcomeDirectMock(...args)
}));

import { mlsConnectServiceV1, mlsConnectServiceV2 } from './mlsService.js';

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

describe('mlsConnectServiceV1', () => {
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
      mockFn.mockResolvedValue({ json: '{"direct":true}' });
    }
  });

  it('delegates every mls method to direct modules', async () => {
    const context = createContext();

    await expect(
      mlsConnectServiceV1.uploadKeyPackages(
        {
          json: '{"keyPackages":[]}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(uploadKeyPackagesDirectMock).toHaveBeenCalledWith(
      { json: '{"keyPackages":[]}' },
      context
    );

    await expect(
      mlsConnectServiceV1.getMyKeyPackages({}, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getMyKeyPackagesDirectMock).toHaveBeenCalledWith({}, context);

    await expect(
      mlsConnectServiceV1.getUserKeyPackages({ userId: 'user-1' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getUserKeyPackagesDirectMock).toHaveBeenCalledWith(
      { userId: 'user-1' },
      context
    );

    await expect(
      mlsConnectServiceV1.deleteKeyPackage({ id: 'pkg-1' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(deleteKeyPackageDirectMock).toHaveBeenCalledWith(
      { id: 'pkg-1' },
      context
    );

    await expect(
      mlsConnectServiceV1.createGroup(
        {
          json: '{"name":"group"}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(createGroupDirectMock).toHaveBeenCalledWith(
      { json: '{"name":"group"}' },
      context
    );

    await expect(mlsConnectServiceV1.listGroups({}, context)).resolves.toEqual({
      json: '{"direct":true}'
    });
    expect(listGroupsDirectMock).toHaveBeenCalledWith({}, context);

    await expect(
      mlsConnectServiceV1.getGroup({ groupId: 'group-1' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getGroupDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-1' },
      context
    );

    await expect(
      mlsConnectServiceV1.updateGroup(
        {
          groupId: 'group-2',
          json: '{"name":"next"}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(updateGroupDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-2', json: '{"name":"next"}' },
      context
    );

    await expect(
      mlsConnectServiceV1.deleteGroup({ groupId: 'group-3' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(deleteGroupDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-3' },
      context
    );

    await expect(
      mlsConnectServiceV1.addGroupMember(
        {
          groupId: 'group-4',
          json: '{"userId":"u1"}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(addGroupMemberDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-4', json: '{"userId":"u1"}' },
      context
    );

    await expect(
      mlsConnectServiceV1.getGroupMembers({ groupId: 'group-5' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getGroupMembersDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-5' },
      context
    );

    await expect(
      mlsConnectServiceV1.removeGroupMember(
        {
          groupId: 'group-6',
          userId: 'user-2',
          json: '{"newEpoch":2}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(removeGroupMemberDirectMock).toHaveBeenCalledWith(
      {
        groupId: 'group-6',
        userId: 'user-2',
        json: '{"newEpoch":2}'
      },
      context
    );

    await expect(
      mlsConnectServiceV1.sendGroupMessage(
        {
          groupId: 'group-7',
          json: '{"ciphertext":"x"}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(sendGroupMessageDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-7', json: '{"ciphertext":"x"}' },
      context
    );

    await expect(
      mlsConnectServiceV1.getGroupMessages(
        {
          groupId: 'group-8',
          cursor: 'c-1',
          limit: 20
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getGroupMessagesDirectMock).toHaveBeenCalledWith(
      {
        groupId: 'group-8',
        cursor: 'c-1',
        limit: 20
      },
      context
    );

    await expect(
      mlsConnectServiceV1.getGroupState({ groupId: 'group-9' }, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getGroupStateDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-9' },
      context
    );

    await expect(
      mlsConnectServiceV1.uploadGroupState(
        {
          groupId: 'group-10',
          json: '{"epoch":3}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(uploadGroupStateDirectMock).toHaveBeenCalledWith(
      { groupId: 'group-10', json: '{"epoch":3}' },
      context
    );

    await expect(
      mlsConnectServiceV1.getWelcomeMessages({}, context)
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(getWelcomeMessagesDirectMock).toHaveBeenCalledWith({}, context);

    await expect(
      mlsConnectServiceV1.acknowledgeWelcome(
        {
          id: 'welcome-1',
          json: '{"groupId":"group-1"}'
        },
        context
      )
    ).resolves.toEqual({ json: '{"direct":true}' });
    expect(acknowledgeWelcomeDirectMock).toHaveBeenCalledWith(
      { id: 'welcome-1', json: '{"groupId":"group-1"}' },
      context
    );
  });
});

describe('mlsConnectServiceV2', () => {
  beforeEach(() => {
    uploadKeyPackagesDirectMock.mockReset();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      json: '{"ok":true}'
    });
  });

  it('adapts payload/json shapes for v2 handlers', async () => {
    const context = createContext();

    await expect(
      mlsConnectServiceV2.uploadKeyPackages(
        { payload: { keyPackages: [] } },
        context
      )
    ).resolves.toEqual({
      payload: { ok: true }
    });
    expect(uploadKeyPackagesDirectMock).toHaveBeenCalledWith(
      { json: '{"keyPackages":[]}' },
      context
    );
  });

  it('defaults empty request payloads to an empty object json body', async () => {
    const context = createContext();

    await expect(
      mlsConnectServiceV2.uploadKeyPackages({}, context)
    ).resolves.toEqual({
      payload: { ok: true }
    });
    expect(uploadKeyPackagesDirectMock).toHaveBeenCalledWith(
      { json: '{}' },
      context
    );
  });

  it('returns empty payload when direct response json is invalid', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      json: '{invalid-json'
    });

    await expect(
      mlsConnectServiceV2.uploadKeyPackages(
        { payload: { keyPackages: [] } },
        context
      )
    ).resolves.toEqual({
      payload: {}
    });
  });

  it('returns empty payload when direct response json is not an object', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      json: '[]'
    });

    await expect(
      mlsConnectServiceV2.uploadKeyPackages(
        { payload: { keyPackages: [] } },
        context
      )
    ).resolves.toEqual({
      payload: {}
    });
  });
});
