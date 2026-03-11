import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockSelectChain,
  renderContactDetail,
  TEST_CONTACT,
  TEST_EMAILS,
  TEST_PHONES
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
    thisContact:
      'Database is locked. Enter your password to view this contact.',
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
    ClientContactsProvider: ({ children }: { children: React.ReactNode }) => {
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

describe('ContactDetail editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
  });

  describe('entering edit mode', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('edit-first-name')).toBeInTheDocument();
      expect(screen.getByTestId('edit-last-name')).toBeInTheDocument();
      expect(screen.getByTestId('edit-birthday')).toBeInTheDocument();
    });

    it('populates form with current contact data', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('edit-first-name')).toHaveValue('John');
      expect(screen.getByTestId('edit-last-name')).toHaveValue('Doe');
      expect(screen.getByTestId('edit-birthday')).toHaveValue('1990-05-15');
    });

    it('shows save and cancel buttons in edit mode', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('save-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
      expect(screen.queryByTestId('edit-button')).not.toBeInTheDocument();
    });

    it('shows email inputs in edit mode', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('edit-email-email-1')).toHaveValue(
        'john@example.com'
      );
      expect(screen.getByTestId('edit-email-email-2')).toHaveValue(
        'john.personal@example.com'
      );
    });

    it('shows phone inputs in edit mode', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('edit-phone-phone-1')).toHaveValue(
        '+1-555-0100'
      );
    });
  });

  describe('cancel edit mode', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('exits edit mode on cancel', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));
      expect(screen.getByTestId('save-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-button'));

      expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      expect(screen.queryByTestId('save-button')).not.toBeInTheDocument();
    });

    it('discards changes on cancel', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const firstNameInput = screen.getByTestId('edit-first-name');
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'Jane');

      await user.click(screen.getByTestId('cancel-button'));

      // Back to view mode with original name
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  describe('adding emails and phones', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([
          [TEST_CONTACT],
          [], // No existing emails
          [] // No existing phones
        ])
      );
    });

    it('can add a new email', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));
      await user.click(screen.getByTestId('add-email-button'));

      // Should have a new empty email input
      const emailInputs = screen.getAllByPlaceholderText('Email address');
      expect(emailInputs.length).toBe(1);
    });

    it('can add a new phone', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));
      await user.click(screen.getByTestId('add-phone-button'));

      // Should have a new empty phone input
      const phoneInputs = screen.getAllByPlaceholderText('Phone number');
      expect(phoneInputs.length).toBe(1);
    });
  });

  describe('deleting emails and phones', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('can delete an email', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      // Should have 2 emails initially
      expect(screen.getByTestId('edit-email-email-1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-email-email-2')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-email-email-1'));

      // First email should be removed from view
      expect(
        screen.queryByTestId('edit-email-email-1')
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('edit-email-email-2')).toBeInTheDocument();
    });

    it('can delete a phone', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      expect(screen.getByTestId('edit-phone-phone-1')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-phone-phone-1'));

      expect(
        screen.queryByTestId('edit-phone-phone-1')
      ).not.toBeInTheDocument();
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

      expect(screen.getByText('Email #1 cannot be empty.')).toBeInTheDocument();
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

      expect(screen.getByText('Phone #1 cannot be empty.')).toBeInTheDocument();
    });
  });
});
