import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatGroupInfo } from './GroupItem';
import { GroupList } from './GroupList';

describe('GroupList', () => {
  const mockOnSelectGroup = vi.fn();
  const mockOnCreateGroup = vi.fn();

  const mockGroups: ChatGroupInfo[] = [
    { id: 'group-1', name: 'Work Chat', memberCount: 5 },
    { id: 'group-2', name: 'Family', memberCount: 3 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with title', () => {
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    expect(screen.getByText('Encrypted Chats')).toBeInTheDocument();
  });

  it('renders list of groups', () => {
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    expect(screen.getByText('Work Chat')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
  });

  it('calls onSelectGroup when a group is clicked', async () => {
    const user = userEvent.setup();
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    await user.click(screen.getByText('Work Chat'));
    expect(mockOnSelectGroup).toHaveBeenCalledWith('group-1');
  });

  it('calls onCreateGroup when create button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    await user.click(screen.getByRole('button', { name: /create new group/i }));
    expect(mockOnCreateGroup).toHaveBeenCalled();
  });

  it('shows empty state when no groups', () => {
    render(
      <GroupList
        groups={[]}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    expect(screen.getByText('No groups yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first group')).toBeInTheDocument();
  });

  it('shows loading state when isLoading is true', () => {
    render(
      <GroupList
        groups={[]}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
        isLoading={true}
      />
    );

    expect(screen.queryByText('No groups yet')).not.toBeInTheDocument();
  });

  it('highlights selected group', () => {
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId="group-1"
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    const selectedButton = screen.getByText('Work Chat').closest('button');
    expect(selectedButton).toHaveClass('bg-accent');
  });

  it('shows lock icon in header', () => {
    render(
      <GroupList
        groups={mockGroups}
        selectedGroupId={null}
        onSelectGroup={mockOnSelectGroup}
        onCreateGroup={mockOnCreateGroup}
      />
    );

    const lockIcon = document.querySelector('.lucide-lock');
    expect(lockIcon).toBeInTheDocument();
  });
});
