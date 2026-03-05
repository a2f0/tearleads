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

import { mlsConnectServiceV2 } from './mlsService.js';

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

  it('throws internal error when direct response json is invalid', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      json: '{invalid-json'
    });

    await expect(
      mlsConnectServiceV2.uploadKeyPackages(
        { payload: { keyPackages: [] } },
        context
      )
    ).rejects.toThrow('direct service returned invalid payload JSON');
  });

  it('throws internal error when direct response json is not an object', async () => {
    const context = createContext();
    uploadKeyPackagesDirectMock.mockResolvedValue({
      json: '[]'
    });

    await expect(
      mlsConnectServiceV2.uploadKeyPackages(
        { payload: { keyPackages: [] } },
        context
      )
    ).rejects.toThrow('direct service payload must decode to a JSON object');
  });
});
