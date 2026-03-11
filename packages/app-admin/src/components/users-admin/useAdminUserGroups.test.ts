import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useAdminUserGroups } from './useAdminUserGroups';

vi.mock('@/lib/api', () => ({
  api: {
    adminV2: {
      groups: {
        list: vi.fn(),
        getMembers: vi.fn(),
        addMember: vi.fn(),
        removeMember: vi.fn()
      }
    }
  }
}));

describe('useAdminUserGroups', () => {
  const mockUserId = 'user-1';
  type AdminGroupListItem = ReturnType<
    typeof useAdminUserGroups
  >['groups'][number];
  const mockGroups: AdminGroupListItem[] = [
    {
      id: 'group-1',
      organizationId: 'org-1',
      name: 'Group 1',
      description: 'Desc 1',
      memberCount: 5,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z'
    },
    {
      id: 'group-2',
      organizationId: 'org-1',
      name: 'Group 2',
      description: 'Desc 2',
      memberCount: 10,
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-04T00:00:00Z'
    }
  ];
  const listSpy = vi.spyOn(api.adminV2.groups, 'list');
  const getMembersSpy = vi.spyOn(api.adminV2.groups, 'getMembers');
  const addMemberSpy = vi.spyOn(api.adminV2.groups, 'addMember');
  const removeMemberSpy = vi.spyOn(api.adminV2.groups, 'removeMember');

  beforeEach(() => {
    vi.clearAllMocks();
    listSpy.mockResolvedValue({ groups: mockGroups });
    getMembersSpy.mockImplementation((groupId: string) => {
      if (groupId === 'group-1') {
        return Promise.resolve({
          members: [
            {
              userId: mockUserId,
              email: 'user-1@example.com',
              joinedAt: '2024-01-01T00:00:00Z'
            }
          ]
        });
      }
      return Promise.resolve({ members: [] });
    });
  });

  it('fetches groups and memberships on mount', async () => {
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.groups).toEqual(mockGroups);
    expect(result.current.groupMemberships).toEqual({
      'group-1': { isMember: true, joinedAt: '2024-01-01T00:00:00Z' },
      'group-2': { isMember: false, joinedAt: undefined }
    });
    expect(api.adminV2.groups.list).toHaveBeenCalled();
  });

  it('handles adding a user to a group', async () => {
    addMemberSpy.mockResolvedValue({ added: true });
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addToGroup('group-2');
    });

    expect(api.adminV2.groups.addMember).toHaveBeenCalledWith(
      'group-2',
      mockUserId
    );
    await waitFor(() => {
      expect(result.current.groupMemberships['group-2'].isMember).toBe(true);
      expect(
        result.current.groups.find((group) => group.id === 'group-2')
          ?.memberCount
      ).toBe(11);
    });
  });

  it('handles removing a user from a group', async () => {
    removeMemberSpy.mockResolvedValue({ removed: true });
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeFromGroup('group-1');
    });

    expect(api.adminV2.groups.removeMember).toHaveBeenCalledWith(
      'group-1',
      mockUserId
    );
    await waitFor(() => {
      expect(result.current.groupMemberships['group-1'].isMember).toBe(false);
      expect(
        result.current.groups.find((group) => group.id === 'group-1')
          ?.memberCount
      ).toBe(4);
    });
  });

  it('handles errors when fetching groups', async () => {
    listSpy.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });
  });
});
