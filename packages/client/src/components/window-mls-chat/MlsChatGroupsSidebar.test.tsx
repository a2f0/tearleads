import type { ActiveGroup } from '@tearleads/mls-chat';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MlsChatGroupsSidebar } from './MlsChatGroupsSidebar';

const createMockGroup = (
  overrides: Partial<ActiveGroup> = {}
): ActiveGroup => ({
  id: 'group-1',
  name: 'Test Group',
  memberCount: 3,
  unreadCount: 0,
  canDecrypt: true,
  lastMessageAt: undefined,
  ...overrides
});

const mockGroups: ActiveGroup[] = [
  createMockGroup({ id: 'group-1', name: 'Work Chat', memberCount: 5 }),
  createMockGroup({
    id: 'group-2',
    name: 'Family',
    memberCount: 3,
    unreadCount: 2
  })
];

describe('MlsChatGroupsSidebar', () => {
  it('renders Groups header', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('renders empty state when no groups', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    expect(
      screen.getByText('No groups yet. Create one to start chatting.')
    ).toBeInTheDocument();
  });

  it('renders groups list', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    expect(screen.getByText('Work Chat')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // member count
    expect(screen.getByText('3')).toBeInTheDocument(); // member count
  });

  it('shows unread count badge', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    // Family group has 2 unread
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows loading indicator', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
        isLoading={true}
      />
    );

    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
        error="Failed to load groups"
      />
    );

    expect(screen.getByText('Failed to load groups')).toBeInTheDocument();
  });

  it('calls onGroupSelect when clicking a group', () => {
    const onGroupSelect = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId={null}
        onGroupSelect={onGroupSelect}
        onCreateGroup={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Work Chat'));
    expect(onGroupSelect).toHaveBeenCalledWith('group-1');
  });

  it('highlights selected group', () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId="group-1"
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const workChatButton = screen.getByText('Work Chat').closest('button');
    expect(workChatButton).toHaveClass('bg-accent');
  });

  it('calls onCreateGroup when clicking plus button', () => {
    const onCreateGroup = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={onCreateGroup}
      />
    );

    const newButton = screen.getByTitle('New Group');
    fireEvent.click(newButton);
    expect(onCreateGroup).toHaveBeenCalled();
  });

  it('opens context menu on right-click', async () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const workChatButton = screen.getByText('Work Chat').closest('button');
    if (workChatButton) fireEvent.contextMenu(workChatButton);

    await waitFor(() => {
      expect(screen.getByTestId('group-context-menu')).toBeInTheDocument();
    });
  });

  it('closes context menu on backdrop click', async () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={mockGroups}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const workChatButton = screen.getByText('Work Chat').closest('button');
    if (workChatButton) fireEvent.contextMenu(workChatButton);

    await waitFor(() => {
      expect(screen.getByTestId('group-context-menu')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('group-context-menu-backdrop'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('group-context-menu')
      ).not.toBeInTheDocument();
    });
  });

  it('opens empty space context menu on right-click', async () => {
    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const sidebar = screen.getByTestId('mls-chat-groups-sidebar');
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (scrollableArea) fireEvent.contextMenu(scrollableArea);

    await waitFor(() => {
      expect(
        screen.getByTestId('empty-space-context-menu')
      ).toBeInTheDocument();
    });
  });

  it('calls onCreateGroup from empty space context menu', async () => {
    const onCreateGroup = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={vi.fn()}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={onCreateGroup}
      />
    );

    const sidebar = screen.getByTestId('mls-chat-groups-sidebar');
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (scrollableArea) fireEvent.contextMenu(scrollableArea);

    await waitFor(() => {
      expect(screen.getByText('New Group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Group'));
    expect(onCreateGroup).toHaveBeenCalled();
  });

  it('calls onWidthChange when resizing', () => {
    const onWidthChange = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={onWidthChange}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize groups sidebar');

    fireEvent.mouseDown(resizeHandle, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('handles keyboard resize with ArrowRight key', () => {
    const onWidthChange = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={onWidthChange}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize groups sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(onWidthChange).toHaveBeenCalledWith(210);
  });

  it('handles keyboard resize with ArrowLeft key', () => {
    const onWidthChange = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={onWidthChange}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize groups sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

    expect(onWidthChange).toHaveBeenCalledWith(190);
  });

  it('ignores non-arrow keys for keyboard resize', () => {
    const onWidthChange = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={onWidthChange}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize groups sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'Enter' });

    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it('respects min and max width constraints', () => {
    const onWidthChange = vi.fn();

    render(
      <MlsChatGroupsSidebar
        width={200}
        onWidthChange={onWidthChange}
        groups={[]}
        selectedGroupId={null}
        onGroupSelect={vi.fn()}
        onCreateGroup={vi.fn()}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize groups sidebar');

    // Try to resize below minimum (150)
    fireEvent.mouseDown(resizeHandle, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);

    // Should clamp to minimum
    expect(onWidthChange).toHaveBeenCalledWith(150);
  });
});
