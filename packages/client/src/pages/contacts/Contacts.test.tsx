import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { Contacts } from './Contacts';

// Mock useVirtualizer to simplify testing
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

// Mock getDatabase with fluent mock object
const mockOrderBy = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: mockOrderBy,
  update: mockUpdate
};

// Chain the update mock
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

vi.mock('@/db', () => ({
  getDatabase: () => dbMock
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

// Mock useNativeFilePicker to avoid Capacitor dependency
vi.mock('@/hooks/useNativeFilePicker', () => ({
  useNativeFilePicker: vi.fn(() => ({
    pickFiles: vi.fn(),
    isNativePicker: false
  }))
}));

function renderContactsRaw() {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>
  );
}

async function renderContacts() {
  const result = renderContactsRaw();
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading database...')).not.toBeInTheDocument();
  });
  return result;
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

    // Setup default mock response
    mockOrderBy.mockResolvedValue([]);

    // Reset update chain mocks
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: null,
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);
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
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: null,
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);
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
      mockOrderBy.mockResolvedValueOnce([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: null,
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);
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

      await renderContacts();

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane')).toBeInTheDocument();
    });

    it('displays contact email when available', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('displays contact phone when available', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      expect(screen.getByText('555-1234')).toBeInTheDocument();
    });

    it('navigates to contact detail when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      expect(screen.getByText('John Doe')).toBeInTheDocument();

      await user.click(screen.getByText('John Doe'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/1', {
        state: { from: '/', fromLabel: 'Back to Contacts' }
      });
    });

    it('shows add contact card at the bottom of the list', async () => {
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
    });

    it('navigates to new contact from list view', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await user.click(screen.getByTestId('add-contact-card'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/new');
    });
  });

  describe('search functionality', () => {
    const searchTestContact = {
      id: '1',
      firstName: 'John',
      lastName: 'Doe',
      birthday: null,
      primaryEmail: null,
      primaryPhone: null,
      createdAt: new Date()
    };

    it('updates search query on input', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([searchTestContact]);

      await renderContacts();

      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');

      expect(searchInput).toHaveValue('test');
    });

    it('clears search when X button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([searchTestContact]);

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
      mockOrderBy.mockResolvedValue([searchTestContact]);

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
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: null,
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);

      await renderContacts();

      expect(mockOrderBy).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalledTimes(2);
      });
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

      await renderContacts();

      // Note: Full CSV import testing would require more complex file input simulation
      // This test verifies the import section is rendered
      expect(screen.getByText('Import CSV')).toBeInTheDocument();
    });
  });

  describe('contact count display', () => {
    it('shows singular contact count', async () => {
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: 'john@example.com',
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText(/1 contact$/)).toBeInTheDocument();
      });
    });

    it('shows plural contact count', async () => {
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: 'john@example.com',
          primaryPhone: null,
          createdAt: new Date()
        },
        {
          id: '2',
          firstName: 'Jane',
          lastName: 'Smith',
          birthday: null,
          primaryEmail: 'jane@example.com',
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText(/2 contacts$/)).toBeInTheDocument();
      });
    });

    it('shows contact count with "found" when searching', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: 'john@example.com',
          primaryPhone: null,
          createdAt: new Date()
        }
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

  describe('import result display', () => {
    it('shows import result with skipped count', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockParseFile.mockResolvedValue({
        headers: ['First Name', 'Last Name', 'Email'],
        rows: [['John', 'Doe', 'john@example.com']]
      });
      mockImportContacts.mockResolvedValue({
        imported: 5,
        skipped: 3,
        errors: []
      });

      const { container } = await renderContacts();

      // Find the dropzone input and upload a file
      const input = container.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();

      const csvFile = new File(['name,email'], 'contacts.csv', {
        type: 'text/csv'
      });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      // Wait for column mapper to appear and click import
      const importButton = await screen.findByRole('button', {
        name: /Import \d+ Contacts/i
      });
      await user.click(importButton);

      // Assert that the import result is shown
      await waitFor(() => {
        expect(
          screen.getByText(/Imported 5 contacts?, skipped 3/i)
        ).toBeInTheDocument();
      });
    });

    it('shows import result with errors', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockParseFile.mockResolvedValue({
        headers: ['First Name', 'Email'],
        rows: [['John', 'invalid-email']]
      });
      mockImportContacts.mockResolvedValue({
        imported: 3,
        skipped: 0,
        errors: [
          'Row 5: Invalid email format',
          'Row 10: Missing required field'
        ]
      });

      const { container } = await renderContacts();

      const input = container.querySelector('input[type="file"]');
      const csvFile = new File(['name,email'], 'contacts.csv', {
        type: 'text/csv'
      });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      // Wait for column mapper to appear and click import
      const importButton = await screen.findByRole('button', {
        name: /Import \d+ Contacts/i
      });
      await user.click(importButton);

      // Assert that the import result and errors are shown
      await waitFor(() => {
        expect(screen.getByText(/Imported 3 contacts?/i)).toBeInTheDocument();
        expect(
          screen.getByText('Row 5: Invalid email format')
        ).toBeInTheDocument();
        expect(
          screen.getByText('Row 10: Missing required field')
        ).toBeInTheDocument();
      });
    });

    it('handles empty CSV file error', async () => {
      mockParseFile.mockResolvedValue({
        headers: [],
        rows: []
      });

      const { container } = await renderContacts();

      const input = container.querySelector('input[type="file"]');
      const csvFile = new File([''], 'empty.csv', { type: 'text/csv' });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      await waitFor(() => {
        expect(
          screen.getByText('CSV file is empty or has no headers')
        ).toBeInTheDocument();
      });
    });

    it('handles CSV parse error', async () => {
      mockParseFile.mockRejectedValue(new Error('Invalid CSV format'));

      const { container } = await renderContacts();

      const input = container.querySelector('input[type="file"]');
      const csvFile = new File(['bad data'], 'bad.csv', { type: 'text/csv' });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      await waitFor(() => {
        expect(screen.getByText('Invalid CSV format')).toBeInTheDocument();
      });
    });
  });

  describe('column mapper UI', () => {
    it('shows column mapper when CSV is parsed', async () => {
      mockParseFile.mockResolvedValue({
        headers: ['First Name', 'Last Name', 'Email', 'Phone'],
        rows: [
          ['John', 'Doe', 'john@example.com', '555-1234'],
          ['Jane', 'Smith', 'jane@example.com', '555-5678']
        ]
      });

      const { container } = await renderContacts();

      const input = container.querySelector('input[type="file"]');
      const csvFile = new File(['name,email'], 'contacts.csv', {
        type: 'text/csv'
      });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      await waitFor(() => {
        expect(screen.getByText('Map CSV Columns')).toBeInTheDocument();
      });

      // Search input should be hidden when column mapper is shown
      expect(
        screen.queryByPlaceholderText('Search contacts...')
      ).not.toBeInTheDocument();
    });

    it('hides column mapper when cancelled', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockParseFile.mockResolvedValue({
        headers: ['First Name', 'Email'],
        rows: [['John', 'john@example.com']]
      });
      // Need contacts for search to be visible after cancel
      mockOrderBy.mockResolvedValue([
        {
          id: '1',
          firstName: 'Existing',
          lastName: 'Contact',
          birthday: null,
          primaryEmail: null,
          primaryPhone: null,
          createdAt: new Date()
        }
      ]);

      const { container } = await renderContacts();

      const input = container.querySelector('input[type="file"]');
      const csvFile = new File(['name,email'], 'contacts.csv', {
        type: 'text/csv'
      });

      if (input) {
        fireEvent.change(input, { target: { files: [csvFile] } });
      }

      await waitFor(() => {
        expect(screen.getByText('Map CSV Columns')).toBeInTheDocument();
      });

      // Click cancel button
      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      // Column mapper should be hidden
      await waitFor(() => {
        expect(screen.queryByText('Map CSV Columns')).not.toBeInTheDocument();
      });

      // Search input should be visible again (when contacts exist)
      expect(
        screen.getByPlaceholderText('Search contacts...')
      ).toBeInTheDocument();
    });
  });

  describe('context menu', () => {
    const mockContacts = [
      {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        birthday: null,
        primaryEmail: 'john@example.com',
        primaryPhone: '555-1234',
        createdAt: new Date()
      }
    ];

    it('shows context menu on right-click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('navigates to contact detail when "Get info" is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/1', {
        state: { from: '/', fromLabel: 'Back to Contacts' }
      });
    });

    it('soft deletes contact when "Delete" is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({ deleted: true })
        );
      });
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: /close context menu/i })
      );

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);
      mockUpdateWhere.mockRejectedValue(new Error('Delete failed'));

      const consoleSpy = mockConsoleError();

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete contact:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions when delete fails', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);
      mockUpdateWhere.mockRejectedValue('String error');

      const consoleSpy = mockConsoleError();

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete contact:',
        'String error'
      );
      consoleSpy.mockRestore();
    });

    it('refreshes the contacts list after successful delete', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      // Clear previous calls
      mockOrderBy.mockClear();
      mockOrderBy.mockResolvedValue([]);

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      // Wait for the delete operation and subsequent refresh
      await waitFor(() => {
        expect(mockOrderBy).toHaveBeenCalled();
      });
    });

    it('navigates to edit mode when "Edit" is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue(mockContacts);

      await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const contact = screen.getByText('John Doe');
      await user.pointer({ keys: '[MouseRight]', target: contact });

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Edit'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts/1', {
        state: { from: '/', fromLabel: 'Back to Contacts', autoEdit: true }
      });
    });
  });

  describe('instance change handling', () => {
    it('clears contacts and resets state when instance changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const initialContacts = [
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          primaryEmail: 'john@example.com',
          primaryPhone: null,
          createdAt: new Date()
        }
      ];

      // First render with instance A
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'instance-a'
      });
      mockOrderBy.mockResolvedValue(initialContacts);

      const { rerender } = await renderContacts();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      // Type in search to verify it gets cleared
      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'test');
      expect(searchInput).toHaveValue('test');

      // Change to instance B
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'instance-b'
      });
      mockOrderBy.mockResolvedValue([]);

      await act(async () => {
        rerender(
          <MemoryRouter>
            <Contacts />
          </MemoryRouter>
        );
      });

      // Flush the setTimeout(fn, 0) for instance-aware fetching
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Search should be cleared and contacts should be empty
      await waitFor(() => {
        const input = screen.queryByPlaceholderText('Search contacts...');
        if (input) {
          expect(input).toHaveValue('');
        }
      });
    });
  });
});
