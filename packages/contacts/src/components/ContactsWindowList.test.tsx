import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContactsProvider } from '../test/test-utils';
import { ContactsWindowList } from './ContactsWindowList';

const mockUseContacts = vi.fn();
const mockUseVirtualizer = vi.fn();

vi.mock('../hooks/useContacts', () => ({
  useContacts: () => mockUseContacts()
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => mockUseVirtualizer()
}));

describe('ContactsWindowList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [{ index: 0, start: 0 }],
      getTotalSize: () => 56,
      measureElement: vi.fn()
    });
    mockUseContacts.mockReturnValue({
      contactsList: [
        {
          id: 'contact-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          primaryEmail: 'ada@example.com',
          primaryPhone: null
        }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      fetchContacts: vi.fn(),
      setHasFetched: vi.fn()
    });
  });

  it('sends email to the primary email from context menu', () => {
    const openEmailComposer = vi.fn(() => true);

    render(
      <TestContactsProvider openEmailComposer={openEmailComposer}>
        <ContactsWindowList
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    fireEvent.contextMenu(screen.getByTestId('list-row'));
    fireEvent.click(screen.getByText('Send email'));

    expect(openEmailComposer).toHaveBeenCalledWith(['ada@example.com']);
  });

  it('does not show send email when contact has no primary email', () => {
    mockUseContacts.mockReturnValue({
      contactsList: [
        {
          id: 'contact-1',
          firstName: 'No',
          lastName: 'Email',
          primaryEmail: null,
          primaryPhone: null
        }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      fetchContacts: vi.fn(),
      setHasFetched: vi.fn()
    });

    render(
      <TestContactsProvider>
        <ContactsWindowList
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    fireEvent.contextMenu(screen.getByTestId('list-row'));
    expect(screen.queryByText('Send email')).not.toBeInTheDocument();
  });

  it('does not show empty-space menu when right-clicking a contact row', () => {
    render(
      <TestContactsProvider>
        <ContactsWindowList
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    fireEvent.contextMenu(screen.getByTestId('list-row'));

    expect(screen.getByText('Send email')).toBeInTheDocument();
    expect(screen.queryByText('New Contact')).not.toBeInTheDocument();
  });

  it('focuses search input on render', async () => {
    render(
      <TestContactsProvider>
        <ContactsWindowList
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId('window-contacts-search')
      );
    });
  });
});
