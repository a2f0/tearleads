import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactDetail } from './ContactDetail';

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

const TEST_CONTACT = {
  id: 'contact-123',
  firstName: 'John',
  lastName: 'Doe',
  birthday: '1990-05-15',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  deleted: false
};

const TEST_EMAILS = [
  {
    id: 'email-1',
    contactId: 'contact-123',
    email: 'john@example.com',
    label: 'work',
    isPrimary: true
  },
  {
    id: 'email-2',
    contactId: 'contact-123',
    email: 'john.personal@example.com',
    label: 'personal',
    isPrimary: false
  }
];

const TEST_PHONES = [
  {
    id: 'phone-1',
    contactId: 'contact-123',
    phoneNumber: '+1-555-0100',
    label: 'mobile',
    isPrimary: true
  }
];

function createMockSelectChain(results: unknown[][]) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => {
          const result = results[callIndex] ?? [];
          callIndex++;
          return Promise.resolve(result);
        }),
        orderBy: vi.fn().mockImplementation(() => {
          const result = results[callIndex] ?? [];
          callIndex++;
          return Promise.resolve(result);
        })
      }),
      orderBy: vi.fn().mockImplementation(() => {
        const result = results[callIndex] ?? [];
        callIndex++;
        return Promise.resolve(result);
      })
    })
  }));
}

function createMockUpdateChain() {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    })
  });
}

function createMockInsertChain() {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined)
  });
}

function createMockDeleteChain() {
  return vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined)
  });
}

function renderContactDetail(contactId: string = 'contact-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/contacts/${contactId}`]}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/contacts" element={<div>Contacts List</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

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

      expect(screen.getByText('First name is required')).toBeInTheDocument();
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
        screen.getByText('Email address cannot be empty')
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
        screen.getByText('Phone number cannot be empty')
      ).toBeInTheDocument();
    });
  });

  describe('saving changes', () => {
    beforeEach(() => {
      // For save tests, we need the select to work multiple times
      // First for initial load, second for refresh after save
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
