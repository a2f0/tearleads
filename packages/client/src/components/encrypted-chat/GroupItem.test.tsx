import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatGroupInfo, GroupItem } from './GroupItem';

describe('GroupItem', () => {
  const mockOnClick = vi.fn();
  const baseGroup: ChatGroupInfo = {
    id: 'group-1',
    name: 'Test Group',
    memberCount: 5
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group name and member count', () => {
    render(
      <GroupItem group={baseGroup} isSelected={false} onClick={mockOnClick} />
    );

    expect(screen.getByText('Test Group')).toBeInTheDocument();
    expect(screen.getByText('5 members')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    render(
      <GroupItem group={baseGroup} isSelected={false} onClick={mockOnClick} />
    );

    await user.click(screen.getByRole('button'));
    expect(mockOnClick).toHaveBeenCalled();
  });

  it('applies selected styling when isSelected is true', () => {
    render(
      <GroupItem group={baseGroup} isSelected={true} onClick={mockOnClick} />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-accent');
  });

  it('shows last message when provided', () => {
    const groupWithMessage: ChatGroupInfo = {
      ...baseGroup,
      lastMessage: 'Hello everyone!'
    };
    render(
      <GroupItem
        group={groupWithMessage}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
    expect(screen.queryByText('5 members')).not.toBeInTheDocument();
  });

  it('shows relative time for recent messages', () => {
    const now = new Date();
    const groupWithTime: ChatGroupInfo = {
      ...baseGroup,
      lastMessageTime: new Date(now.getTime() - 5 * 60 * 1000)
    };
    render(
      <GroupItem
        group={groupWithTime}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('shows unread count badge when > 0', () => {
    const groupWithUnread: ChatGroupInfo = {
      ...baseGroup,
      unreadCount: 3
    };
    render(
      <GroupItem
        group={groupWithUnread}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows 99+ for unread count over 99', () => {
    const groupWithManyUnread: ChatGroupInfo = {
      ...baseGroup,
      unreadCount: 150
    };
    render(
      <GroupItem
        group={groupWithManyUnread}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show unread badge when count is 0', () => {
    const groupNoUnread: ChatGroupInfo = {
      ...baseGroup,
      unreadCount: 0
    };
    render(
      <GroupItem
        group={groupNoUnread}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows "now" for very recent messages', () => {
    const groupWithNow: ChatGroupInfo = {
      ...baseGroup,
      lastMessageTime: new Date()
    };
    render(
      <GroupItem
        group={groupWithNow}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('now')).toBeInTheDocument();
  });

  it('shows hours for messages within a day', () => {
    const now = new Date();
    const groupWithHours: ChatGroupInfo = {
      ...baseGroup,
      lastMessageTime: new Date(now.getTime() - 3 * 60 * 60 * 1000)
    };
    render(
      <GroupItem
        group={groupWithHours}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('3h')).toBeInTheDocument();
  });

  it('shows days for messages within a week', () => {
    const now = new Date();
    const groupWithDays: ChatGroupInfo = {
      ...baseGroup,
      lastMessageTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    };
    render(
      <GroupItem
        group={groupWithDays}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('3d')).toBeInTheDocument();
  });

  it('shows date for older messages', () => {
    // Use a date that's definitely more than a week ago
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const groupWithOldDate: ChatGroupInfo = {
      ...baseGroup,
      lastMessageTime: twoWeeksAgo
    };
    render(
      <GroupItem
        group={groupWithOldDate}
        isSelected={false}
        onClick={mockOnClick}
      />
    );

    // The format should contain month abbreviation and day number (e.g., "Jan 10")
    const expectedText = twoWeeksAgo.toLocaleDateString([], {
      month: 'short',
      day: 'numeric'
    });
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });
});
