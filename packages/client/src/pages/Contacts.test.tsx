import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contacts } from './Contacts';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock getDatabase
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockLeftJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect
  })
}));

// Mock useContactsImport
const mockParseFile = vi.fn();
const mockImportContacts = vi.fn();
vi.mock('@/hooks/useContactsImport', () => ({
  useContactsImport: () => ({
    parseFile: mockParseFile,
    importContacts: mockImportContacts,
    importing: false,
    progress: 0
  })
}));

function renderContacts() {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>
  );
}

describe('Contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default: database is unlocked
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });

    // Setup database query chain
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ leftJoin: mockLeftJoin });
    mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderContacts();

      expect(screen.getByText('Contacts')).toBeInTheDocument();
    });

    it('renders search input when database is unlocked', async () => {
      renderContacts();

      expect(
        screen.getByPlaceholderText('Search contacts...')
      ).toBeInTheDocument();
    });

    it('renders refresh button when database is unlocked', async () => {
      renderContacts();

      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });

    it('renders Import CSV section when database is unlocked', async () => {
      renderContacts();

      expect(screen.getByText('Import CSV')).toBeInTheDocument();
    });
  });

  describe('database loading state', () => {
    it('shows loading message when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });

      renderContacts();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });
  });

  describe('database locked state', () => {
    it('shows locked message when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });

      renderContacts();

      expect(
        screen.getByText(
          'Database is locked. Unlock it from the SQLite page to view contacts.'
        )
      ).toBeInTheDocument();
    });

    it('does not show search input when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });

      renderContacts();

      expect(
        screen.queryByPlaceholderText('Search contacts...')
      ).not.toBeInTheDocument();
    });

    it('does not show Import CSV section when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });

      renderContacts();

      expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no contacts exist', async () => {
      mockOrderBy.mockResolvedValue([]);

      renderContacts();

      await waitFor(() => {
        expect(
          screen.getByText('No contacts yet. Import a CSV to get started.')
        ).toBeInTheDocument();
      });
    });

    it('shows no results message when search has no matches', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([]);

      renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'nonexistent');

      // Advance timers for debounce
      await vi.advanceTimersByTimeAsync(300);

      await waitFor(() => {
        expect(
          screen.getByText('No contacts found matching "nonexistent"')
        ).toBeInTheDocument();
      });
    });
  });

  describe('contacts list', () => {
    const mockContacts = [
      {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-01',
        primaryEmail: 'john@example.com',
        primaryPhone: '555-1234',
        createdAt: new Date()
      },
      {
        id: '2',
        firstName: 'Jane',
        lastName: null,
        birthday: null,
        primaryEmail: 'jane@example.com',
        primaryPhone: null,
        createdAt: new Date()
      }
    ];

    it('displays contacts when they exist', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane')).toBeInTheDocument();
      });
    });

    it('displays contact email when available', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      renderContacts();

      await waitFor(() => {
        expect(screen.getByText('john@example.com')).toBeInTheDocument();
        expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      });
    });

    it('displays contact phone when available', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      renderContacts();

      await waitFor(() => {
        expect(screen.getByText('555-1234')).toBeInTheDocument();
      });
    });

    it('navigates to contact detail when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.click(screen.getByText('John Doe'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/1');
    });
  });

  describe('search functionality', () => {
    it('updates search query on input', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');

      expect(searchInput).toHaveValue('test');
    });

    it('clears search when X button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');

      expect(searchInput).toHaveValue('test');

      // Click the clear button (X)
      const clearButton = screen.getByRole('button', { name: '' });
      await user.click(clearButton);

      expect(searchInput).toHaveValue('');
    });

    it('debounces search queries', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      renderContacts();

      // Initial fetch
      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(1);
      });

      const searchInput = screen.getByPlaceholderText('Search contacts...');

      // Type quickly
      await user.type(searchInput, 'abc');

      // Should not have made additional queries yet (debounced)
      expect(mockOrderBy).toHaveBeenCalledTimes(1);

      // Advance timers past debounce
      await vi.advanceTimersByTimeAsync(300);

      await waitFor(() => {
        // After debounce, should have made one more query
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes contacts when Refresh button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      renderContacts();

      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      mockOrderBy.mockRejectedValue(new Error('Database error'));

      renderContacts();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });
  });

  describe('CSV import', () => {
    it('shows import result after successful import', async () => {
      mockImportContacts.mockResolvedValue({
        imported: 5,
        skipped: 2,
        errors: []
      });

      mockParseFile.mockResolvedValue({
        headers: ['First Name', 'Last Name', 'Email'],
        rows: [['John', 'Doe', 'john@example.com']]
      });

      renderContacts();

      // Note: Full CSV import testing would require more complex file input simulation
      // This test verifies the import section is rendered
      expect(screen.getByText('Import CSV')).toBeInTheDocument();
    });
  });
});
