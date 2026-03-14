// one-component-per-file: allow
import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactNew } from './ContactNew';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

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

const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => ({
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
    thisContact: 'this contact',
    createContact: 'contacts',
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
        }: React.ComponentPropsWithoutRef<'button'>) => (
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            {...props}
          >
            {btnChildren}
          </button>
        ),
        Input: ({
          value,
          onChange,
          inputRef,
          ...props
        }: React.ComponentPropsWithoutRef<'input'> & {
          inputRef?: React.Ref<HTMLInputElement>;
        }) => (
          <input ref={inputRef} value={value} onChange={onChange} {...props} />
        ),
        BackLink: ({ defaultLabel }: { defaultLabel?: React.ReactNode }) => (
          <a href="/" data-testid="back-link">
            {defaultLabel}
          </a>
        ),
        InlineUnlock: ({ description }: { description?: React.ReactNode }) => (
          <div data-testid="inline-unlock">Unlock to access {description}</div>
        ),
        ContextMenu: ({ children: c }: { children?: React.ReactNode }) => (
          <div>{c}</div>
        ),
        ContextMenuItem: ({
          children: c,
          onClick
        }: {
          children?: React.ReactNode;
          onClick?: React.MouseEventHandler<HTMLButtonElement>;
        }) => (
          <button type="button" onClick={onClick}>
            {c}
          </button>
        ),
        ListRow: ({ children: c }: { children?: React.ReactNode }) => (
          <div>{c}</div>
        ),
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

function createMockInsertChain() {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined)
  });
}

function renderContactNew() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/contacts/new']}>
        <Routes>
          <Route path="/contacts/new" element={<ContactNew />} />
          <Route path="/contacts" element={<div>Contacts List</div>} />
          <Route path="/contacts/:id" element={<div>Contact Detail</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('ContactNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockInsert.mockImplementation(createMockInsertChain());
  });

  describe('rendering', () => {
    it('displays the page title', () => {
      renderContactNew();

      expect(screen.getByText('New Contact')).toBeInTheDocument();
    });

    it('displays form fields', () => {
      renderContactNew();

      expect(screen.getByTestId('new-first-name')).toBeInTheDocument();
      expect(screen.getByTestId('new-last-name')).toBeInTheDocument();
      expect(screen.getByTestId('new-birthday')).toBeInTheDocument();
    });

    it('displays save and cancel buttons', () => {
      renderContactNew();

      expect(screen.getByTestId('save-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    });

    it('displays add email and add phone buttons', () => {
      renderContactNew();

      expect(screen.getByTestId('add-email-button')).toBeInTheDocument();
      expect(screen.getByTestId('add-phone-button')).toBeInTheDocument();
    });

    it('displays back link to contacts', () => {
      renderContactNew();

      expect(screen.getByText('Back to Contacts')).toBeInTheDocument();
    });
  });

  describe('database loading state', () => {
    it('shows loading message when database is loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });

      renderContactNew();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('shows inline unlock when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderContactNew();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    });
  });

  describe('form input', () => {
    it('can type in first name field', async () => {
      const user = userEvent.setup();
      renderContactNew();

      const input = screen.getByTestId('new-first-name');
      await user.type(input, 'John');

      expect(input).toHaveValue('John');
    });

    it('can type in last name field', async () => {
      const user = userEvent.setup();
      renderContactNew();

      const input = screen.getByTestId('new-last-name');
      await user.type(input, 'Doe');

      expect(input).toHaveValue('Doe');
    });

    it('can type in birthday field', async () => {
      const user = userEvent.setup();
      renderContactNew();

      const input = screen.getByTestId('new-birthday');
      await user.type(input, '1990-05-15');

      expect(input).toHaveValue('1990-05-15');
    });
  });

  describe('adding emails', () => {
    it('can add a new email', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('add-email-button'));

      const emailInputs = screen.getAllByPlaceholderText('Email address');
      expect(emailInputs.length).toBe(1);
    });

    it('can delete an email', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('add-email-button'));

      const emailInputs = screen.getAllByPlaceholderText('Email address');
      expect(emailInputs.length).toBe(1);

      // The delete button in the new code uses t('delete') text
      const deleteButtons = screen.getAllByRole('button', {
        name: /delete/i
      });
      const firstDelete = deleteButtons[0];
      expect(firstDelete).toBeDefined();
      await user.click(firstDelete);

      expect(
        screen.queryByPlaceholderText('Email address')
      ).not.toBeInTheDocument();
    });
  });

  describe('adding phones', () => {
    it('can add a new phone', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('add-phone-button'));

      const phoneInputs = screen.getAllByPlaceholderText('Phone number');
      expect(phoneInputs.length).toBe(1);
    });

    it('can delete a phone', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('add-phone-button'));

      const phoneInputs = screen.getAllByPlaceholderText('Phone number');
      expect(phoneInputs.length).toBe(1);

      // The delete button in the new code uses t('delete') text
      const deleteButtons = screen.getAllByRole('button', {
        name: /delete/i
      });
      const firstDelete = deleteButtons[0];
      expect(firstDelete).toBeDefined();
      await user.click(firstDelete);

      expect(
        screen.queryByPlaceholderText('Phone number')
      ).not.toBeInTheDocument();
    });
  });

  describe('validation', () => {
    it('shows error when first name is empty on save', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('save-button'));

      expect(screen.getByText('First name is required.')).toBeInTheDocument();
    });

    it('shows error when email is empty on save', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.click(screen.getByTestId('add-email-button'));
      await user.click(screen.getByTestId('save-button'));

      expect(screen.getByText('Email #1 cannot be empty.')).toBeInTheDocument();
    });

    it('shows error when phone is empty on save', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.click(screen.getByTestId('add-phone-button'));
      await user.click(screen.getByTestId('save-button'));

      expect(screen.getByText('Phone #1 cannot be empty.')).toBeInTheDocument();
    });
  });

  describe('cancel', () => {
    it('navigates to contacts list on cancel', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.click(screen.getByTestId('cancel-button'));

      expect(mockNavigate).toHaveBeenCalledWith('/contacts');
    });
  });

  describe('save', () => {
    it('saves contact and navigates to detail page', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.type(screen.getByTestId('new-last-name'), 'Doe');
      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.stringMatching(/^\/contacts\/[a-f0-9-]+$/)
        );
      });
    });

    it('saves contact with emails', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.click(screen.getByTestId('add-email-button'));

      const emailInput = screen.getByPlaceholderText('Email address');
      await user.type(emailInput, 'john@example.com');

      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        // 1 for contacts table, 1 for contactEmails table
        expect(mockInsert).toHaveBeenCalledTimes(2);
      });
    });

    it('saves contact with phones', async () => {
      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.click(screen.getByTestId('add-phone-button'));

      const phoneInput = screen.getByPlaceholderText('Phone number');
      await user.type(phoneInput, '555-1234');

      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        // 1 for contacts table, 1 for contactPhones table
        expect(mockInsert).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('save error handling', () => {
    it('shows error message on save failure', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('Database error'))
      });

      const user = userEvent.setup();
      renderContactNew();

      await user.type(screen.getByTestId('new-first-name'), 'John');
      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });
});
