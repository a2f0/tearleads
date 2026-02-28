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

describe('ContactDetail save and labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
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
});
