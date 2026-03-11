import { create } from '@bufbuild/protobuf';
import {
  type AdminUser,
  AdminUserSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserGroups } from './AdminUserGroups';
import * as userGroupsHook from './useAdminUserGroups';

vi.mock('./useAdminUserGroups', () => ({
  useAdminUserGroups: vi.fn()
}));

describe('AdminUserGroups', () => {
  const mockUser: AdminUser = create(AdminUserSchema, {
    id: 'user-1',
    email: 'test@example.com',
    emailConfirmed: true,
    admin: false,
    organizationIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    disabled: false,
    accounting: {
      totalTokens: 0n,
      totalPromptTokens: 0n,
      totalCompletionTokens: 0n,
      requestCount: 0n
    }
  });
  type AdminManagedGroup = ReturnType<
    (typeof userGroupsHook)['useAdminUserGroups']
  >['groups'][number];
  const mockGroups: AdminManagedGroup[] = [
    {
      id: 'group-1',
      organizationId: 'org-1',
      name: 'Group 1',
      description: 'Desc 1',
      memberCount: 5,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z'
    }
  ];
  const useAdminUserGroupsSpy = vi.spyOn(userGroupsHook, 'useAdminUserGroups');
  const buildHookState = (
    overrides: Partial<
      ReturnType<(typeof userGroupsHook)['useAdminUserGroups']>
    > = {}
  ): ReturnType<(typeof userGroupsHook)['useAdminUserGroups']> => ({
    groups: mockGroups,
    groupMemberships: { 'group-1': { isMember: false, joinedAt: undefined } },
    loading: false,
    error: null,
    actionError: null,
    actionId: null,
    fetchGroups: vi.fn(),
    addToGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    setActionError: vi.fn(),
    ...overrides
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAdminUserGroupsSpy.mockReturnValue(buildHookState());
  });

  it('renders groups and handles add action', async () => {
    const hookState = buildHookState();
    useAdminUserGroupsSpy.mockReturnValue(hookState);
    render(<AdminUserGroups user={mockUser} />);

    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Group 1')).toBeInTheDocument();

    const addButton = screen.getByText('Add');
    fireEvent.click(addButton);

    expect(hookState.addToGroup).toHaveBeenCalledWith('group-1');
  });

  it('shows loading state', () => {
    useAdminUserGroupsSpy.mockReturnValue(
      buildHookState({
        groups: [],
        groupMemberships: {},
        loading: true
      })
    );

    render(<AdminUserGroups user={mockUser} />);
    expect(screen.getByText('Loading groups...')).toBeInTheDocument();
  });
});
