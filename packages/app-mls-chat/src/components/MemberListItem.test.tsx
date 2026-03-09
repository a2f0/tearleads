import type { MlsGroupMember } from '@tearleads/shared';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProvider, screen } from '../test/testUtils.js';
import { MemberListItem } from './MemberListItem.js';

const baseMember: MlsGroupMember = {
  userId: 'member-1',
  email: 'member@example.com',
  joinedAt: new Date('2026-01-01').toISOString()
};

describe('MemberListItem', () => {
  it('renders member details', () => {
    renderWithProvider(
      <MemberListItem
        member={baseMember}
        canManageMembers={false}
        onRemoveMember={undefined}
      />
    );

    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Joined/i)).toBeInTheDocument();
  });

  it('shows current user marker', () => {
    renderWithProvider(
      <MemberListItem
        member={{
          ...baseMember,
          userId: 'current-user',
          email: 'current@example.com'
        }}
        canManageMembers={false}
        onRemoveMember={undefined}
      />,
      {
        providerProps: {
          userId: 'current-user',
          userEmail: 'current@example.com'
        }
      }
    );

    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('calls onRemoveMember when remove is clicked', async () => {
    const onRemoveMember = vi.fn();
    renderWithProvider(
      <MemberListItem
        member={baseMember}
        canManageMembers={true}
        onRemoveMember={onRemoveMember}
      />,
      {
        providerProps: { userId: 'different-user' }
      }
    );

    await userEvent.click(screen.getByTestId('dropdown-item'));
    expect(onRemoveMember).toHaveBeenCalledWith('member-1');
  });
});
