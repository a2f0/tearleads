/**
 * Tests for Contacts component rendering, database states, and empty states.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  mockNavigate,
  mockUseDatabaseContext,
  mockOrderBy,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockParseFile,
  mockImportContacts,
  mockExportContact,
  dbMock,
  createMockContact,
  renderContacts,
  renderContactsRaw,
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

describe('Contacts', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderContacts();

      expect(screen.getByText('Contacts')).toBeInTheDocument();
    });

    it('shows back link by default', async () => {
      await renderContacts();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('renders search input when contacts exist', async () => {
      mockOrderBy.mockResolvedValue([createMockContact()]);
      await renderContacts();

      expect(
        screen.getByPlaceholderText('Search contacts...')
      ).toBeInTheDocument();
    });

    it('hides search input when no contacts exist', async () => {
      mockOrderBy.mockResolvedValue([]);
      await renderContacts();

      expect(
        screen.queryByPlaceholderText('Search contacts...')
      ).not.toBeInTheDocument();
    });

    it('renders refresh button when contacts exist', async () => {
      mockOrderBy.mockResolvedValue([createMockContact()]);
      await renderContacts();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });

    it('renders Import CSV section when database is unlocked', async () => {
      await renderContacts();

      expect(screen.getByText('Import CSV')).toBeInTheDocument();
    });
  });

  describe('database loading state', () => {
    it('shows loading message when database is loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });

      renderContactsRaw();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });
  });

  describe('database locked state', () => {
    it('shows inline unlock when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactsRaw();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view contacts./i
        )
      ).toBeInTheDocument();
    });

    it('does not show search input when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactsRaw();

      expect(
        screen.queryByPlaceholderText('Search contacts...')
      ).not.toBeInTheDocument();
    });

    it('does not show Import CSV section when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactsRaw();

      expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows add contact card when no contacts exist', async () => {
      mockOrderBy.mockResolvedValue([]);

      await renderContacts();

      expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
      expect(screen.getByText('Add new contact')).toBeInTheDocument();
    });

    it('navigates to new contact page when add card is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([]);

      await renderContacts();

      await user.click(screen.getByTestId('add-contact-card'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/new');
    });

    it('shows no results message when search has no matches', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // Start with contacts so search is visible
      mockOrderBy.mockResolvedValueOnce([createMockContact()]);
      // Search returns no results
      mockOrderBy.mockResolvedValueOnce([]);

      await renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'nonexistent');

      // Advance timers for debounce wrapped in act() to handle state updates
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      // Wait for debounced fetch to complete
      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });

      expect(
        screen.getByText('No contacts found matching "nonexistent"')
      ).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockOrderBy.mockRejectedValue(new Error('Database error'));

      renderContactsRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch contacts:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
