import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupsList } from './GroupsList';

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      groups: {
        list: (options?: { organizationId?: string }) => mockList(options),
        delete: (id: string) => mockDelete(id)
      }
    }
  }
}));

describe('GroupsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    onGroupSelect: vi.fn()
  };

  function renderGroupsList(props?: {
    onCreateClick?: () => void;
    onGroupSelect?: (groupId: string) => void;
    organizationId?: string | null;
  }) {
    const mergedProps = { ...defaultProps, ...props };
    return render(
      <MemoryRouter>
        <GroupsList {...mergedProps} />
      </MemoryRouter>
    );
  }

  it('renders loading state initially', () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderGroupsList();

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('requests groups scoped to selected organization', async () => {
    mockList.mockResolvedValue({ groups: [] });

    renderGroupsList({ organizationId: 'org-2' });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ organizationId: 'org-2' });
    });
  });

  it('renders groups list after loading', async () => {
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Admins',
          description: 'Admin users',
          memberCount: 3,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'group-2',
          organizationId: 'org-1',
          name: 'Users',
          description: null,
          memberCount: 10,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Admins')).toBeInTheDocument();
    });

    expect(screen.getByText('Admin users')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('3 Members')).toBeInTheDocument();
    expect(screen.getByText('10 Members')).toBeInTheDocument();
  });

  it('renders singular member count correctly', async () => {
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Solo Group',
          description: null,
          memberCount: 1,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('1 member')).toBeInTheDocument();
    });
  });

  it('renders empty state when no groups exist', async () => {
    mockList.mockResolvedValue({ groups: [] });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Create a group to organize users')
    ).toBeInTheDocument();
  });

  it('shows create button in empty state when callback provided', async () => {
    const onCreateClick = vi.fn();
    mockList.mockResolvedValue({ groups: [] });

    renderGroupsList({ onCreateClick });

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: /create group/i });
    expect(createButton).toBeInTheDocument();

    await userEvent.click(createButton);
    expect(onCreateClick).toHaveBeenCalled();
  });

  it('renders error state when fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockRejectedValue(new Error('Network error'));

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('retries fetch when retry button clicked', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ groups: [] });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('calls onGroupSelect when group is clicked', async () => {
    const user = userEvent.setup();
    const onGroupSelect = vi.fn();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList({ onGroupSelect });

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Group'));

    expect(onGroupSelect).toHaveBeenCalledWith('group-1');
  });

  it('opens context menu on right click', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });

    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('opens delete dialog from context menu', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });
    await user.click(screen.getByText('Delete'));

    expect(
      screen.getByText(
        'Are you sure you want to delete "Test Group"? This will remove all members from the group.'
      )
    ).toBeInTheDocument();
  });

  it('deletes group after confirmation', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });
    mockDelete.mockResolvedValue({ deleted: true });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });
    await user.click(screen.getByText('Delete'));

    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('group-1');
    });
  });

  it('closes delete dialog on cancel', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });
    await user.click(screen.getByText('Delete'));

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(
        screen.queryByText(
          'Are you sure you want to delete "Test Group"? This will remove all members from the group.'
        )
      ).not.toBeInTheDocument();
    });
  });

  it('closes context menu when clicking outside', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });

    expect(screen.getByText('Delete')).toBeInTheDocument();

    await user.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes context menu when Escape key is pressed', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          memberCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupsList();

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument();
    });

    const groupRow = screen
      .getByText('Test Group')
      .closest('tr') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: groupRow });

    expect(screen.getByText('Delete')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });
});
