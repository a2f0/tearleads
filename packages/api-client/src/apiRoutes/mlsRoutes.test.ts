import { describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getGroupMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
  createGroup: vi.fn(async () => ({ group: { id: 'group-1' } }))
}));

vi.mock('./mlsV2Routes', () => ({
  mlsV2Routes: {
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    createGroup: routeMocks.createGroup,
    updateGroup: vi.fn(),
    leaveGroup: vi.fn(),
    getGroupMembers: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    getGroupMessages: routeMocks.getGroupMessages,
    sendGroupMessage: vi.fn(),
    getGroupState: vi.fn(),
    uploadGroupState: vi.fn(),
    getMyKeyPackages: vi.fn(),
    getUserKeyPackages: vi.fn(),
    uploadKeyPackages: vi.fn(),
    deleteKeyPackage: vi.fn(),
    getWelcomeMessages: vi.fn(),
    acknowledgeWelcome: vi.fn()
  }
}));

import { mlsRoutes } from './mlsRoutes';

describe('mlsRoutes', () => {
  it('delegates getGroupMessages without optional fields', async () => {
    await mlsRoutes.getGroupMessages('group-1');

    expect(routeMocks.getGroupMessages).toHaveBeenCalledWith('group-1');
  });

  it('delegates createGroup payload without modification', async () => {
    await mlsRoutes.createGroup({
      name: 'MLS Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });

    expect(routeMocks.createGroup).toHaveBeenCalledWith({
      name: 'MLS Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });
  });
});
