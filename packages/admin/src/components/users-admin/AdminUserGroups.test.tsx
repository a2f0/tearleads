import type { AdminUser, GroupWithMemberCount } from '@tearleads/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserGroups } from './AdminUserGroups';
import { useAdminUserGroups } from './useAdminUserGroups';

vi.mock('./useAdminUserGroups');

describe('AdminUserGroups', () => {
  const mockUser: AdminUser = {
    id: 'user-1',
    email: 'test@example.com',
    emailConfirmed: true,
    admin: false,
    organizationIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    lastActiveAt: null,
    accounting: {
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      requestCount: 0,
      lastUsedAt: null
    },
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null
  };
  const mockGroups: GroupWithMemberCount[] = [
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
  const mockedUseAdminUserGroups = vi.mocked(useAdminUserGroups);
  const buildHookState = (
    overrides: Partial<ReturnType<typeof useAdminUserGroups>> = {}
  ): ReturnType<typeof useAdminUserGroups> => ({
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
    mockedUseAdminUserGroups.mockReturnValue(buildHookState());
  });

  it('renders groups and handles add action', async () => {
    const hookState = buildHookState();
    mockedUseAdminUserGroups.mockReturnValue(hookState);
    render(<AdminUserGroups user={mockUser} />);

    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Group 1')).toBeInTheDocument();

    const addButton = screen.getByText('Add');
    fireEvent.click(addButton);

    expect(hookState.addToGroup).toHaveBeenCalledWith('group-1');
  });

  it('shows loading state', () => {
    mockedUseAdminUserGroups.mockReturnValue(
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
