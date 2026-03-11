import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEST_CONTACT,
  TEST_EMAILS,
  TEST_PHONES,
  createMockDeleteChain,
  createMockInsertChain,
  createMockSelectChain,
  createMockUpdateChain,
  renderContactDetail
} from './contactDetailTestSetup';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    activeOrganizationId: null,
    organizations: [],
    setActiveOrganizationId: vi.fn(),
    isLoading: false
  })
}));

// Mock the database
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    delete: mockDelete
  }),
  getDatabaseAdapter: () => ({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined)
  })
}));

// Mock ClientContactsProvider to use test infrastructure
vi.mock('@/contexts/ClientContactsProvider', async () => {
  const { ContactsProvider } = await import('@tearleads/app-contacts');
  const db = await import('@/db');
  const dbHooks = await import('@/db/hooks');
  const router = await import('react-router-dom');

  const translations: Record<string, string> = {
    backToContacts: 'Back to Contacts',
    loadingDatabase: 'Loading database...',
    loadingContact: 'Loading contact...',
    thisContact: 'Database is locked. Enter your password to view this contact.',
    contactNotFound: 'Contact not found',
    firstNameIsRequired: 'First name is required',
    firstNameRequired: 'First name',
    emailCannotBeEmpty: 'Email address cannot be empty',
    phoneCannotBeEmpty: 'Phone number cannot be empty',
    emailAddress: 'Email address',
    emailAddresses: 'Email Addresses',
    phoneNumber: 'Phone number',
    phoneNumbers: 'Phone Numbers',
    addEmail: 'Add Email',
    addPhone: 'Add Phone',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    export: 'Export',
    delete: 'Delete',
    label: 'Label',
    primary: 'Primary',
    lastName: 'Last name',
    birthdayPlaceholder: 'Birthday',
    created: 'Created',
    updated: 'Updated',
    details: 'Details',
    createContact: 'contacts',
    newContactTitle: 'New Contact',
    saveContact: 'Save Contact'
  };

  return {
    ClientContactsProvider: ({
      children
    }: {
      children: React.ReactNode;
    }) => {
      const dbState = dbHooks.useDatabaseContext();
      const navigate = router.useNavigate();

      const mockUI = {
        Button: ({
          children: btnChildren,
          onClick,
          disabled,
          ...props
        }: any) => (
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            {...props}
          >
            {btnChildren}
          </button>
        ),
        Input: ({ value, onChange, inputRef, ...props }: any) => (
          <input ref={inputRef} value={value} onChange={onChange} {...props} />
        ),
        BackLink: ({ defaultLabel }: any) => (
          <a href="/" data-testid="back-link">
            {defaultLabel}
          </a>
        ),
        InlineUnlock: ({ description }: any) => (
          <div data-testid="inline-unlock">
            {description}
            <input data-testid="inline-unlock-password" type="password" />
            <button type="button" data-testid="inline-unlock-button">
              Unlock
            </button>
          </div>
        ),
        ContextMenu: ({ children: c }: any) => <div>{c}</div>,
        ContextMenuItem: ({ children: c, onClick }: any) => (
          <button type="button" onClick={onClick}>
            {c}
          </button>
        ),
        ListRow: ({ children: c }: any) => <div>{c}</div>,
        RefreshButton: () => null,
        VirtualListStatus: () => null,
        DropdownMenu: () => null,
        DropdownMenuItem: () => null,
        DropdownMenuSeparator: () => null,
        WindowOptionsMenuItem: () => null,
        AboutMenuItem: () => null,
        Dropzone: () => null
      };

      return (
        <ContactsProvider
          databaseState={{
            isUnlocked: dbState?.isUnlocked ?? true,
            isLoading: dbState?.isLoading ?? false,
            currentInstanceId: 'test-instance'
          }}
          getDatabase={db.getDatabase}
          getDatabaseAdapter={db.getDatabaseAdapter}
          saveFile={async () => {}}
          registerInVfs={async () => ({ success: true })}
          onContactSaved={async () => {}}
          ui={mockUI}
          t={(key: string) => translations[key] || key}
          tooltipZIndex={10000}
          navigate={navigate}
          navigateWithFrom={navigate}
          formatDate={(d: Date) => d.toLocaleDateString()}
          activeOrganizationId={null}
        >
          {children}
        </ContactsProvider>
      );
    }
  };
});

describe('ContactDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('shows error when first name is empty', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const firstNameInput = screen.getByTestId('edit-first-name');
      await user.clear(firstNameInput);

      await user.click(screen.getByTestId('save-button'));

      expect(screen.getByText('First name is required.')).toBeInTheDocument();
    });

    it('shows error when email is empty', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const emailInput = screen.getByTestId('edit-email-email-1');
      await user.clear(emailInput);

      await user.click(screen.getByTestId('save-button'));

      expect(
        screen.getByText('Email #1 cannot be empty.')
      ).toBeInTheDocument();
    });

    it('shows error when phone is empty', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const phoneInput = screen.getByTestId('edit-phone-phone-1');
      await user.clear(phoneInput);

      await user.click(screen.getByTestId('save-button'));

      expect(
        screen.getByText('Phone #1 cannot be empty.')
      ).toBeInTheDocument();
    });
  });

  describe('saving changes', () => {
    beforeEach(() => {
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        const chain = {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => {
                if (callCount === 0 || callCount === 3) {
                  callCount++;
                  return Promise.resolve([TEST_CONTACT]);
                }
                callCount++;
                return Promise.resolve([]);
              }),
              orderBy: vi.fn().mockImplementation(() => {
                if (callCount === 1 || callCount === 4) {
                  callCount++;
                  return Promise.resolve(TEST_EMAILS);
                }
                if (callCount === 2 || callCount === 5) {
                  callCount++;
                  return Promise.resolve(TEST_PHONES);
                }
                callCount++;
                return Promise.resolve([]);
              })
            }),
            orderBy: vi.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve([]);
            })
          })
        };
        return chain;
      });

      mockUpdate.mockImplementation(createMockUpdateChain());
      mockInsert.mockImplementation(createMockInsertChain());
      mockDelete.mockImplementation(createMockDeleteChain());
    });

    it('saves contact changes', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const firstNameInput = screen.getByTestId('edit-first-name');
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'Jane');

      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('exits edit mode after successful save', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));
      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });
    });
  });

  describe('database locked state', () => {
    it('shows inline unlock when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactDetail();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this contact./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactDetail();

      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactDetail();

      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('shows loading message when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });

      renderContactDetail();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });
  });

  describe('contact not found', () => {
    it('shows error when contact is not found', async () => {
      mockSelect.mockImplementation(
        createMockSelectChain([
          [], // No contact found
          [],
          []
        ])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('Contact not found')).toBeInTheDocument();
      });
    });
  });

  describe('contact without last name', () => {
    it('displays only first name when last name is empty', async () => {
      const contactNoLastName = {
        ...TEST_CONTACT,
        lastName: null
      };

      mockSelect.mockImplementation(
        createMockSelectChain([[contactNoLastName], [], []])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('John')).toBeInTheDocument();
      });
    });
  });

  describe('contact without birthday', () => {
    it('does not display birthday section when birthday is null', async () => {
      const contactNoBirthday = {
        ...TEST_CONTACT,
        birthday: null
      };

      mockSelect.mockImplementation(
        createMockSelectChain([[contactNoBirthday], [], []])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      // Birthday should not be displayed
      expect(screen.queryByText('1990-05-15')).not.toBeInTheDocument();
    });
  });
});
