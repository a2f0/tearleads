import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActiveGroup } from '../lib/index.js';
import { renderWithProvider, screen } from '../test/testUtils.js';
import { GroupListItem } from './GroupListItem.js';

const group: ActiveGroup = {
  id: 'group-1',
  name: 'General',
  canDecrypt: false,
  memberCount: 5,
  unreadCount: 2
};

describe('GroupListItem', () => {
  it('renders group details and unread count', () => {
    renderWithProvider(
      <GroupListItem
        group={group}
        selectedGroupId={null}
        onSelectGroup={() => {}}
      />
    );

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('5 members')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('No keys')).toBeInTheDocument();
  });

  it('calls onSelectGroup when clicked', async () => {
    const onSelectGroup = vi.fn();
    renderWithProvider(
      <GroupListItem
        group={group}
        selectedGroupId={null}
        onSelectGroup={onSelectGroup}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /General/i }));
    expect(onSelectGroup).toHaveBeenCalledWith('group-1');
  });
});
