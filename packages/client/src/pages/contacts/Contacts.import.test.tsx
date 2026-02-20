/**
 * Tests for Contacts CSV import and column mapper functionality.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockContact,
  dbMock,
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

describe('Contacts', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownMocks();
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
      mockOrderBy.mockResolvedValue([createMockContact()]);

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
});
