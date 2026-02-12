import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDatabase, TestContactsProvider } from '../test/test-utils';
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

  it('renders 0 when group contact count is NaN', async () => {
    mockUseContactGroups.mockReturnValue({
      groups: [
        { id: 'group-1', name: 'Empty Group', contactCount: Number.NaN }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      refetch,
      createGroup,
      renameGroup,
      deleteGroup
    });

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

    await waitFor(() => {
      expect(screen.getByText('Empty Group')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    });
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

  it('handles dropping contacts onto a group', async () => {
    const onDropToGroup = vi.fn(async () => undefined);

    render(
      <TestContactsProvider>
        <ContactsGroupsSidebar
          width={220}
          onWidthChange={vi.fn()}
          selectedGroupId={ALL_CONTACTS_ID}
          onGroupSelect={vi.fn()}
          onDropToGroup={onDropToGroup}
        />
      </TestContactsProvider>
    );

    const groupButton = screen.getByText('Family').closest('button');
    expect(groupButton).not.toBeNull();
    if (!groupButton) return;

    fireEvent.drop(groupButton, {
      dataTransfer: {
        getData: (format: string) =>
          format === 'application/x-tearleads-contact-ids'
            ? JSON.stringify({ ids: ['contact-1'] })
            : ''
      }
    });

    await waitFor(() => {
      expect(onDropToGroup).toHaveBeenCalledWith('group-1', ['contact-1']);
    });
  });

  it('sends email to all group primary email recipients', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const openEmailComposer = vi.fn(() => true);

    // Track call count to return different results for different queries
    let selectCallCount = 0;
    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => {
        // First two calls are from updateGroupCounts (returns counts for 2 groups)
        // Third call is from sendEmail (returns emails via orderBy)
        if (selectCallCount <= 2) {
          return Promise.resolve([{ count: 2 }]);
        }
        return chainable;
      };
      chainable['orderBy'] = () =>
        Promise.resolve([
          { email: 'family@example.com' },
          { email: 'family@example.com' },
          { email: 'work@example.com' }
        ]);
      return chainable;
    });

    render(
      <TestContactsProvider
        database={mockDb}
        openEmailComposer={openEmailComposer}
      >
        <ContactsGroupsSidebar
          width={220}
          onWidthChange={vi.fn()}
          selectedGroupId={ALL_CONTACTS_ID}
          onGroupSelect={vi.fn()}
        />
      </TestContactsProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Family')).toBeInTheDocument();
    });

    const groupButton = screen.getByText('Family').closest('button');
    expect(groupButton).not.toBeNull();
    if (!groupButton) return;

    fireEvent.contextMenu(groupButton);
    await user.click(screen.getByText('Send email'));

    expect(openEmailComposer).toHaveBeenCalledWith([
      'family@example.com',
      'work@example.com'
    ]);
  });
});
