import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactDetail } from './ContactDetail';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
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

  it('shows back link to contacts', async () => {
    mockSelect.mockImplementation(
      createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
    );
    renderContactDetail();

    await waitFor(() => {
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });
  });

  describe('view mode', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('displays contact name', async () => {
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });
    });

    it('displays contact birthday', async () => {
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('1990-05-15')).toBeInTheDocument();
      });
    });

    it('displays email addresses', async () => {
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('john@example.com')).toBeInTheDocument();
        expect(
          screen.getByText('john.personal@example.com')
        ).toBeInTheDocument();
      });
    });

    it('displays phone numbers', async () => {
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('+1-555-0100')).toBeInTheDocument();
      });
    });

    it('shows edit button', async () => {
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });
    });

    it('shows primary badge for primary email', async () => {
      renderContactDetail();

      await waitFor(() => {
        const primaryBadges = screen.getAllByText('Primary');
        expect(primaryBadges.length).toBeGreaterThan(0);
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

  describe('fetch error handling', () => {
    it('shows error message when fetch fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error')),
            orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
          }),
          orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
        })
      }));

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('view mode display', () => {
    it('displays email label in view mode', async () => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('(work)')).toBeInTheDocument();
        expect(screen.getByText('(personal)')).toBeInTheDocument();
      });
    });

    it('displays phone label in view mode', async () => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('(mobile)')).toBeInTheDocument();
      });
    });

    it('displays created and updated dates', async () => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );

      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByText('Created')).toBeInTheDocument();
        expect(screen.getByText('Updated')).toBeInTheDocument();
      });
    });
  });
});
