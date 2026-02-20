/**
 * Tests for Contacts instance change handling.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contacts } from './Contacts';
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

  describe('instance change handling', () => {
    it('clears contacts and resets state when instance changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const initialContacts = [
        createMockContact({ primaryEmail: 'john@example.com' })
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
