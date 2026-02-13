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

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      // First call: updateGroupCounts uses groupBy
      chainable['groupBy'] = () =>
        Promise.resolve([
          { groupId: 'group-1', count: 2 },
          { groupId: 'group-2', count: 3 }
        ]);
      // Second call: sendEmail uses orderBy
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

  it('shows context menu with Send email option on right-click', async () => {
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
      expect(screen.getByText('Family')).toBeInTheDocument();
    });

    const groupButton = screen.getByText('Family').closest('button');
    expect(groupButton).not.toBeNull();
    if (!groupButton) return;

    fireEvent.contextMenu(groupButton);

    expect(screen.getByText('Send email')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('handles empty group with no emails gracefully', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const openEmailComposer = vi.fn(() => true);

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      chainable['groupBy'] = () =>
        Promise.resolve([{ groupId: 'group-1', count: 0 }]);
      // Return empty array for group with no contacts that have primary emails
      chainable['orderBy'] = () => Promise.resolve([]);
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

    // openEmailComposer should not be called with empty recipients
    expect(openEmailComposer).not.toHaveBeenCalled();
  });

  it('closes context menu after sending email', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const openEmailComposer = vi.fn(() => true);

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      chainable['groupBy'] = () =>
        Promise.resolve([{ groupId: 'group-1', count: 1 }]);
      chainable['orderBy'] = () =>
        Promise.resolve([{ email: 'test@example.com' }]);
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
    expect(screen.getByText('Send email')).toBeInTheDocument();

    await user.click(screen.getByText('Send email'));

    await waitFor(() => {
      expect(screen.queryByText('Send email')).not.toBeInTheDocument();
    });
  });

  it('handles database error when sending email', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const openEmailComposer = vi.fn(() => true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      chainable['groupBy'] = () =>
        Promise.resolve([{ groupId: 'group-1', count: 1 }]);
      chainable['orderBy'] = () =>
        Promise.reject(new Error('Database query failed'));
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

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[GroupEmail] Failed to send group email:',
        expect.any(Error)
      );
    });

    // openEmailComposer should not be called on error
    expect(openEmailComposer).not.toHaveBeenCalled();

    // Context menu should still close
    await waitFor(() => {
      expect(screen.queryByText('Send email')).not.toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('uses mailto fallback when openEmailComposer is not provided', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const windowOpenSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(() => null);

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      chainable['groupBy'] = () =>
        Promise.resolve([{ groupId: 'group-1', count: 2 }]);
      chainable['orderBy'] = () =>
        Promise.resolve([
          { email: 'alice@example.com' },
          { email: 'bob@example.com' }
        ]);
      return chainable;
    });

    render(
      <TestContactsProvider database={mockDb}>
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

    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'mailto:alice%40example.com,bob%40example.com',
        '_blank',
        'noopener,noreferrer'
      );
    });

    windowOpenSpy.mockRestore();
  });

  it('deduplicates email addresses when sending to group', async () => {
    const mockDb = createMockDatabase();
    const user = userEvent.setup();
    const openEmailComposer = vi.fn(() => true);

    mockDb.select.mockImplementation(() => {
      const chainable: Record<string, unknown> = {};
      chainable['from'] = () => chainable;
      chainable['innerJoin'] = () => chainable;
      chainable['where'] = () => chainable;
      chainable['groupBy'] = () =>
        Promise.resolve([{ groupId: 'group-1', count: 3 }]);
      // Return duplicate emails
      chainable['orderBy'] = () =>
        Promise.resolve([
          { email: 'same@example.com' },
          { email: 'same@example.com' },
          { email: 'same@example.com' },
          { email: 'different@example.com' }
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

    // Should deduplicate - only unique emails
    expect(openEmailComposer).toHaveBeenCalledWith([
      'same@example.com',
      'different@example.com'
    ]);
  });
});
