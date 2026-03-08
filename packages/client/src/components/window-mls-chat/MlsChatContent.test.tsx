import type { ActiveGroup } from '@tearleads/mls-chat';
import type { MlsGroupMember } from '@tearleads/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the mls-chat components to avoid React version conflicts
vi.mock('@tearleads/mls-chat', () => ({
  MlsChatWindow: ({
    groupName,
    onOpenMembers,
    onLeaveGroup
  }: {
    groupName: string;
    onOpenMembers?: () => void;
    onLeaveGroup?: () => void;
  }) => (
    <div data-testid="mls-chat-window">
      <span>{groupName}</span>
      {onOpenMembers && (
        <button
          type="button"
          onClick={onOpenMembers}
          data-testid="open-members"
        >
          Open Members
        </button>
      )}
      {onLeaveGroup && (
        <button type="button" onClick={onLeaveGroup} data-testid="leave-group">
          Leave group
        </button>
      )}
    </div>
  ),
  MemberList: ({
    members,
    isLoading
  }: {
    members: MlsGroupMember[];
    isLoading?: boolean;
  }) => (
    <div data-testid="member-list">
      {isLoading ? (
        <span>Loading...</span>
      ) : (
        members.map((m) => <div key={m.userId}>{m.email}</div>)
      )}
    </div>
  )
}));

import { MlsChatContent } from './MlsChatContent';

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

const createMockMember = (
  overrides: Partial<MlsGroupMember> = {}
): MlsGroupMember => ({
  userId: 'user-1',
  email: 'member@example.com',
  leafIndex: 0,
  role: 'member',
  joinedAt: '2024-01-01T00:00:00Z',
  joinedAtEpoch: 1,
  ...overrides
});

describe('MlsChatContent', () => {
  it('renders empty state when no group selected', () => {
    render(
      <MlsChatContent
        selectedGroup={null}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    expect(
      screen.getByText('Select a group to start chatting')
    ).toBeInTheDocument();
    expect(screen.getByText('Connection: connected')).toBeInTheDocument();
  });

  it('renders chat window when group is selected', () => {
    const mockGroup = createMockGroup({ name: 'My Chat Group' });

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    expect(screen.getByTestId('mls-chat-window')).toBeInTheDocument();
    expect(screen.getByText('My Chat Group')).toBeInTheDocument();
  });

  it('shows members panel when onOpenMembers is triggered', async () => {
    const mockGroup = createMockGroup();
    const mockMembers = [createMockMember({ email: 'alice@example.com' })];

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={mockMembers}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    // Click the open members button
    fireEvent.click(screen.getByTestId('open-members'));

    await waitFor(() => {
      expect(screen.getByText('Members')).toBeInTheDocument();
      expect(screen.getByTestId('member-list')).toBeInTheDocument();
    });
  });

  it('hides members panel when close button is clicked', async () => {
    const mockGroup = createMockGroup();
    const mockMembers = [createMockMember()];

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={mockMembers}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    // Open members panel
    fireEvent.click(screen.getByTestId('open-members'));

    await waitFor(() => {
      expect(screen.getByText('Members')).toBeInTheDocument();
    });

    // Close members panel - find button inside the members section
    const membersSection = screen.getByText('Members').closest('div');
    const closeButton = membersSection?.querySelector('button');
    if (closeButton) fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
    });
  });

  it('calls onLeaveGroup after confirmation', () => {
    const mockGroup = createMockGroup();
    const onLeaveGroup = vi.fn();

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={onLeaveGroup}
      />
    );

    // Click the leave group button
    fireEvent.click(screen.getByTestId('leave-group'));

    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to leave this group?'
    );
    expect(onLeaveGroup).toHaveBeenCalled();
  });

  it('does not call onLeaveGroup when confirmation is cancelled', () => {
    const mockGroup = createMockGroup();
    const onLeaveGroup = vi.fn();

    // Mock window.confirm to return false
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={onLeaveGroup}
      />
    );

    // Click the leave group button
    fireEvent.click(screen.getByTestId('leave-group'));

    expect(window.confirm).toHaveBeenCalled();
    expect(onLeaveGroup).not.toHaveBeenCalled();
  });

  it('renders without onLoadMore', () => {
    const mockGroup = createMockGroup();

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={false}
        connectionState="connected"
        onSend={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    expect(screen.getByTestId('mls-chat-window')).toBeInTheDocument();
  });

  it('renders with onLoadMore provided', () => {
    const mockGroup = createMockGroup();
    const onLoadMore = vi.fn();

    render(
      <MlsChatContent
        selectedGroup={mockGroup}
        messages={[]}
        members={[]}
        isMessagesLoading={false}
        isMembersLoading={false}
        isSending={false}
        hasMore={true}
        connectionState="connected"
        onSend={vi.fn()}
        onLoadMore={onLoadMore}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onLeaveGroup={vi.fn()}
      />
    );

    expect(screen.getByTestId('mls-chat-window')).toBeInTheDocument();
  });
});
