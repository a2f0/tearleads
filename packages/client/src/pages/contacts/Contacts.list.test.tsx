/**
 * Tests for Contacts list display, search, and refresh functionality.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockContact,
  dbMock,
  mockContactsList,
  mockExportContact,
  mockImportContacts,
  mockNavigate,
  mockOrderBy,
  mockParseFile,
  mockUseDatabaseContext,
  renderContacts,
  setupDefaultMocks,
  teardownMocks
} from './Contacts.testSetup';

// vi.mock calls must be inline - they reference exported mock functions
vi.mock('@tearleads/contacts', async () => {
  const actual = await vi.importActual('@tearleads/contacts');
  return {
    ...actual,
    ALL_CONTACTS_ID: '__all__',
    ContactsGroupsSidebar: () => <div data-testid="contacts-groups-sidebar" />
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 72,
        size: 72,
        key: i
      })),
    getTotalSize: () => count * 72,
    measureElement: vi.fn()
  }))
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: vi.fn(),
    requestWindowOpen: vi.fn()
  })
}));

vi.mock('@/db', () => ({
  getDatabase: () => dbMock,
  getDatabaseAdapter: () => ({
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn()
  })
}));

vi.mock('@/hooks/contacts', () => ({
  useContactsImport: () => ({
    parseFile: mockParseFile,
    importContacts: mockImportContacts,
    importing: false,
    progress: 0
  }),
  useContactsExport: () => ({
    exportContact: mockExportContact,
    exportAllContacts: vi.fn(),
    exporting: false
  })
}));

vi.mock('@/hooks/dnd', () => ({
  useNativeFilePicker: vi.fn(() => ({
    pickFiles: vi.fn(),
    isNativePicker: false
  }))
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    activeOrganizationId: null,
    organizations: [],
    setActiveOrganizationId: vi.fn(),
    isLoading: false
  })
}));

describe('Contacts', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  describe('contacts list', () => {
    it('displays contacts when they exist', async () => {
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane')).toBeInTheDocument();
    });

    it('displays contact email when available', async () => {
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('displays contact phone when available', async () => {
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      expect(screen.getByText('555-1234')).toBeInTheDocument();
    });

    it('navigates to contact detail when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      expect(screen.getByText('John Doe')).toBeInTheDocument();

      await user.click(screen.getByText('John Doe'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/1', {
        state: { from: '/', fromLabel: 'Back to Contacts' }
      });
    });

    it('shows add contact card at the bottom of the list', async () => {
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
    });

    it('navigates to new contact from list view', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContactsList);

      await renderContacts();

      await user.click(screen.getByTestId('add-contact-card'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/new');
    });
  });

  describe('search functionality', () => {
    it('updates search query on input', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([createMockContact()]);

      await renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');

      expect(searchInput).toHaveValue('test');
    });

    it('clears search when X button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([createMockContact()]);

      await renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');

      expect(searchInput).toHaveValue('test');

      // Click the clear button (X)
      const clearButton = screen.getByRole('button', { name: 'Clear search' });
      await user.click(clearButton);

      expect(searchInput).toHaveValue('');
    });

    it('debounces search queries', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([createMockContact()]);

      await renderContacts();

      // Initial fetch already happened in renderContacts
      expect(mockOrderBy).toHaveBeenCalledTimes(1);

      const searchInput = screen.getByPlaceholderText('Search contacts...');

      // Type quickly
      await user.type(searchInput, 'abc');

      // Should not have made additional queries yet (debounced)
      expect(mockOrderBy).toHaveBeenCalledTimes(1);

      // Advance timers past debounce wrapped in act() to handle state updates
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      // Wait for debounced fetch to complete
      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes contacts when Refresh button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([createMockContact()]);

      await renderContacts();

      expect(mockOrderBy).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('contact count display', () => {
    it('shows singular contact count', async () => {
      mockOrderBy.mockResolvedValue([
        createMockContact({ primaryEmail: 'john@example.com' })
      ]);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText(/1 contact$/)).toBeInTheDocument();
      });
    });

    it('shows plural contact count', async () => {
      mockOrderBy.mockResolvedValue([
        createMockContact({
          id: '1',
          firstName: 'John',
          primaryEmail: 'john@example.com'
        }),
        createMockContact({
          id: '2',
          firstName: 'Jane',
          lastName: 'Smith',
          primaryEmail: 'jane@example.com'
        })
      ]);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText(/2 contacts$/)).toBeInTheDocument();
      });
    });

    it('shows contact count with "found" when searching', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([
        createMockContact({ primaryEmail: 'john@example.com' })
      ]);

      await renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'john');

      // Advance timers for debounce
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(screen.getByText(/1 contact(s)? found$/)).toBeInTheDocument();
      });
    });
  });
});
