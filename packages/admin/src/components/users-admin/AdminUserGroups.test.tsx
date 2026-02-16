import type { AdminUser } from '@tearleads/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserGroups } from './AdminUserGroups';
import { useAdminUserGroups } from './useAdminUserGroups';

vi.mock('./useAdminUserGroups');

describe('AdminUserGroups', () => {
  const mockUser: AdminUser = {
    id: 'user-1',
    email: 'test@example.com'
  } as any;
  const mockGroups = [
    { id: 'group-1', name: 'Group 1', description: 'Desc 1', memberCount: 5 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAdminUserGroups as any).mockReturnValue({
      groups: mockGroups,
      groupMemberships: { 'group-1': { isMember: false } },
      loading: false,
      error: null,
      actionError: null,
      actionId: null,
      fetchGroups: vi.fn(),
      addToGroup: vi.fn(),
      removeFromGroup: vi.fn()
    });
  });

  it('renders groups and handles add action', async () => {
    const { addToGroup } = (useAdminUserGroups as any)();
    render(<AdminUserGroups user={mockUser} />);

    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Group 1')).toBeInTheDocument();

    const addButton = screen.getByText('Add');
    fireEvent.click(addButton);

    expect(addToGroup).toHaveBeenCalledWith('group-1');
  });

  it('shows loading state', () => {
    (useAdminUserGroups as any).mockReturnValue({
      groups: [],
      groupMemberships: {},
      loading: true,
      error: null,
      actionError: null,
      actionId: null,
      fetchGroups: vi.fn(),
      addToGroup: vi.fn(),
      removeFromGroup: vi.fn()
    });

    render(<AdminUserGroups user={mockUser} />);
    expect(screen.getByText('Loading groups...')).toBeInTheDocument();
  });
});
