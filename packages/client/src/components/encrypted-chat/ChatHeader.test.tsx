import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHeader } from './ChatHeader';

describe('ChatHeader', () => {
  const mockOnAddMembers = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group name', () => {
    render(
      <ChatHeader
        groupName="Test Group"
        memberCount={5}
        onAddMembers={mockOnAddMembers}
      />
    );

    expect(screen.getByText('Test Group')).toBeInTheDocument();
  });

  it('renders member count with correct pluralization', () => {
    render(
      <ChatHeader
        groupName="Test Group"
        memberCount={5}
        onAddMembers={mockOnAddMembers}
      />
    );

    expect(screen.getByText(/5 members/)).toBeInTheDocument();
  });

  it('renders singular member for count of 1', () => {
    render(
      <ChatHeader
        groupName="Solo Group"
        memberCount={1}
        onAddMembers={mockOnAddMembers}
      />
    );

    expect(screen.getByText(/1 member -/)).toBeInTheDocument();
  });

  it('shows encryption status', () => {
    render(
      <ChatHeader
        groupName="Test Group"
        memberCount={5}
        onAddMembers={mockOnAddMembers}
      />
    );

    expect(screen.getByText(/End-to-end encrypted/)).toBeInTheDocument();
  });

  it('calls onAddMembers when add button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ChatHeader
        groupName="Test Group"
        memberCount={5}
        onAddMembers={mockOnAddMembers}
      />
    );

    await user.click(screen.getByRole('button', { name: /add members/i }));
    expect(mockOnAddMembers).toHaveBeenCalled();
  });

  it('shows users icon', () => {
    render(
      <ChatHeader
        groupName="Test Group"
        memberCount={5}
        onAddMembers={mockOnAddMembers}
      />
    );

    const usersIcon = document.querySelector('.lucide-users');
    expect(usersIcon).toBeInTheDocument();
  });
});
