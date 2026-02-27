/**
 * Tests for Contacts context menu functionality.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  dbMock,
  mockContextMenuContact,
  mockExportContact,
  mockImportContacts,
  mockNavigate,
  mockOrderBy,
  mockParseFile,
  mockSet,
  mockUpdate,
  mockUpdateWhere,
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

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);
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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);
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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
      mockOrderBy.mockResolvedValue([mockContextMenuContact]);

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
});
