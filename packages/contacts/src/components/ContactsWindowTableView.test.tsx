import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContactsProvider } from '../test/test-utils';
import { ContactsWindowTableView } from './ContactsWindowTableView';

const mockUseContacts = vi.fn();

vi.mock('../hooks/useContacts', () => ({
  useContacts: () => mockUseContacts()
}));

describe('ContactsWindowTableView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        <ContactsWindowTableView
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    const row = screen.getByText('Ada Lovelace').closest('tr');
    expect(row).not.toBeNull();
    if (!row) return;

    fireEvent.contextMenu(row);
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
        <ContactsWindowTableView
          onSelectContact={vi.fn()}
          onCreateContact={vi.fn()}
          groupId={undefined}
        />
      </TestContactsProvider>
    );

    const row = screen.getByText('No Email').closest('tr');
    expect(row).not.toBeNull();
    if (!row) return;

    fireEvent.contextMenu(row);
    expect(screen.queryByText('Send email')).not.toBeInTheDocument();
  });
});
