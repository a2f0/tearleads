import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useAdminUserGroups } from './useAdminUserGroups';

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
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
  const mockGroups = [
    { id: 'group-1', name: 'Group 1', description: 'Desc 1', memberCount: 5 },
    { id: 'group-2', name: 'Group 2', description: 'Desc 2', memberCount: 10 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.admin.groups.list as any).mockResolvedValue({ groups: mockGroups });
    (api.admin.groups.getMembers as any).mockImplementation((groupId: string) => {
      if (groupId === 'group-1') {
        return Promise.resolve({ members: [{ userId: mockUserId, joinedAt: '2024-01-01T00:00:00Z' }] });
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
    expect(api.admin.groups.list).toHaveBeenCalled();
  });

  it('handles adding a user to a group', async () => {
    (api.admin.groups.addMember as any).mockResolvedValue({});
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addToGroup('group-2');
    });

    expect(api.admin.groups.addMember).toHaveBeenCalledWith('group-2', mockUserId);
    await waitFor(() => {
      expect(result.current.groupMemberships['group-2'].isMember).toBe(true);
      expect(result.current.groups.find(g => g.id === 'group-2')?.memberCount).toBe(11);
    });
  });

  it('handles removing a user from a group', async () => {
    (api.admin.groups.removeMember as any).mockResolvedValue({});
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeFromGroup('group-1');
    });

    expect(api.admin.groups.removeMember).toHaveBeenCalledWith('group-1', mockUserId);
    await waitFor(() => {
      expect(result.current.groupMemberships['group-1'].isMember).toBe(false);
      expect(result.current.groups.find(g => g.id === 'group-1')?.memberCount).toBe(4);
    });
  });

  it('handles errors when fetching groups', async () => {
    (api.admin.groups.list as any).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useAdminUserGroups(mockUserId));

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });
  });
});
