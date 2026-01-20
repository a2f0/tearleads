import { ThemeProvider } from '@rapid/ui';
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

  describe('setting primary email', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('can change primary email via radio button', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      // Find the radio buttons for primary email
      const radioButtons = screen.getAllByRole('radio', { name: /primary/i });
      const emailRadios = radioButtons.filter(
        (r) => r.getAttribute('name') === 'primaryEmail'
      );
      expect(emailRadios.length).toBe(2);

      // The first email is already primary, so click the second one
      const secondEmailRadio = emailRadios.find(
        (radio) => !(radio as HTMLInputElement).checked
      );

      if (!secondEmailRadio) {
        throw new Error('Could not find second email radio button to test');
      }

      await user.click(secondEmailRadio);

      // Verify that the second radio button is now checked
      expect(secondEmailRadio).toBeChecked();
    });
  });

  describe('setting primary phone', () => {
    const TEST_MULTIPLE_PHONES = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1-555-0100',
        label: 'mobile',
        isPrimary: true
      },
      {
        id: 'phone-2',
        contactId: 'contact-123',
        phoneNumber: '+1-555-0200',
        label: 'work',
        isPrimary: false
      }
    ];

    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([
          [TEST_CONTACT],
          TEST_EMAILS,
          TEST_MULTIPLE_PHONES
        ])
      );
    });

    it('can change primary phone via radio button', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      // Verify both phone inputs are present
      expect(screen.getByTestId('edit-phone-phone-1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-phone-phone-2')).toBeInTheDocument();

      // Find phone radio buttons
      const radioButtons = screen.getAllByRole('radio', { name: /primary/i });
      const phoneRadios = radioButtons.filter(
        (r) => r.getAttribute('name') === 'primaryPhone'
      );
      expect(phoneRadios.length).toBe(2);

      // Click the non-primary phone radio button
      const secondPhoneRadio = phoneRadios.find(
        (radio) => !(radio as HTMLInputElement).checked
      );

      if (!secondPhoneRadio) {
        throw new Error('Could not find second phone radio button to test');
      }

      await user.click(secondPhoneRadio);

      // Verify that the second radio button is now checked
      expect(secondPhoneRadio).toBeChecked();
    });
  });

  describe('editing email labels', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('can edit email label', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const labelInput = screen.getByTestId('edit-email-label-email-1');
      expect(labelInput).toHaveValue('work');

      await user.clear(labelInput);
      await user.type(labelInput, 'home');

      expect(labelInput).toHaveValue('home');
    });
  });

  describe('editing phone labels', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('can edit phone label', async () => {
      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));

      const labelInput = screen.getByTestId('edit-phone-label-phone-1');
      expect(labelInput).toHaveValue('mobile');

      await user.clear(labelInput);
      await user.type(labelInput, 'office');

      expect(labelInput).toHaveValue('office');
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

  describe('save failure with rollback', () => {
    beforeEach(() => {
      mockSelect.mockImplementation(
        createMockSelectChain([[TEST_CONTACT], TEST_EMAILS, TEST_PHONES])
      );
    });

    it('shows error and rolls back transaction on save failure', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Make update fail
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Save failed'))
        })
      });

      const user = userEvent.setup();
      renderContactDetail();

      await waitFor(() => {
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-button'));
      await user.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
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
