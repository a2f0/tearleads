import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContactsProvider } from '../test/test-utils';
import {
  ALL_CONTACTS_ID,
  ContactsGroupsSidebar
} from './ContactsGroupsSidebar';

const mockUseContactGroups = vi.fn();

vi.mock('../hooks', async () => {
  const actual = await vi.importActual('../hooks');
  return {
    ...actual,
    useContactGroups: () => mockUseContactGroups()
  };
});

describe('ContactsGroupsSidebar', () => {
  const createGroup = vi.fn(async () => 'group-3');
  const renameGroup = vi.fn(async () => undefined);
  const deleteGroup = vi.fn(async () => undefined);
  const refetch = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContactGroups.mockReturnValue({
      groups: [
        { id: 'group-1', name: 'Family', contactCount: 2 },
        { id: 'group-2', name: 'Work', contactCount: 3 }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      refetch,
      createGroup,
      renameGroup,
      deleteGroup
    });
  });

  it('renders groups and handles selection', async () => {
    const onGroupSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <TestContactsProvider>
        <ContactsGroupsSidebar
          width={220}
          onWidthChange={vi.fn()}
          selectedGroupId={ALL_CONTACTS_ID}
          onGroupSelect={onGroupSelect}
        />
      </TestContactsProvider>
    );

    expect(screen.getByText('All Contacts')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();

    await user.click(screen.getByText('Family'));
    expect(onGroupSelect).toHaveBeenCalledWith('group-1');
  });

  it('creates a new group from dialog', async () => {
    const user = userEvent.setup();

    render(
      <TestContactsProvider>
        <ContactsGroupsSidebar
          width={220}
          onWidthChange={vi.fn()}
          selectedGroupId={ALL_CONTACTS_ID}
          onGroupSelect={vi.fn()}
        />
      </TestContactsProvider>
    );

    await user.click(screen.getByTitle('New Group'));
    await user.type(screen.getByPlaceholderText('Group name'), 'Friends');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith('Friends');
    });
  });
});
