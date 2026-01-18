import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { ContactsWindowDetail } from './ContactsWindowDetail';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

vi.mock('@/lib/utils', () => ({
  formatDate: (date: Date) => date.toISOString().split('T')[0],
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}));

const mockContact = {
  id: 'contact-123',
  firstName: 'John',
  lastName: 'Doe',
  birthday: '1990-01-15',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  deleted: false
};

const mockEmails = [
  {
    id: 'email-1',
    contactId: 'contact-123',
    email: 'john@example.com',
    label: 'Work',
    isPrimary: true
  }
];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([mockContact]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined)
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb,
  getDatabaseAdapter: () => ({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined)
  })
}));

describe('ContactsWindowDetail', () => {
  const defaultProps = {
    contactId: 'contact-123',
    onBack: vi.fn(),
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDb.limit.mockResolvedValue([mockContact]);
    mockDb.orderBy.mockImplementation(() => {
      // Return different results based on what's being queried
      return Promise.resolve(mockEmails);
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.update.mockReturnThis();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowDetail {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<ContactsWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders back button', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('window-contact-back')).toBeInTheDocument();

    // Wait for any async operations to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading contact...')).not.toBeInTheDocument();
    });
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ContactsWindowDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-contact-back'));
    expect(onBack).toHaveBeenCalled();

    // Wait for any async operations to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading contact...')).not.toBeInTheDocument();
    });
  });

  it('displays contact name when loaded', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('displays birthday when loaded', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('1990-01-15')).toBeInTheDocument();
    });
  });

  it('shows error when contact not found', async () => {
    mockDb.limit.mockResolvedValue([]);
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Contact not found')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    mockDb.limit.mockRejectedValue(new Error('Database error'));
    const consoleSpy = mockConsoleError();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch contact:',
      expect.any(Error)
    );
  });

  it('renders edit button when contact is loaded', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });
  });

  it('renders delete button when contact is loaded', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-delete')).toBeInTheDocument();
    });
  });

  it('calls onDeleted when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<ContactsWindowDetail {...defaultProps} onDeleted={onDeleted} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-delete'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('enters edit mode when edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-first-name')).toBeInTheDocument();
      expect(screen.getByTestId('window-edit-last-name')).toBeInTheDocument();
    });
  });

  it('shows save and cancel buttons in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-save')).toBeInTheDocument();
      expect(screen.getByTestId('window-contact-cancel')).toBeInTheDocument();
    });
  });

  it('exits edit mode when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-cancel')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-cancel'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('window-edit-first-name')
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });
  });

  it('displays details section with dates', async () => {
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });

  it('allows editing first name in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-first-name')).toBeInTheDocument();
    });

    const firstNameInput = screen.getByTestId('window-edit-first-name');
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'Jane');

    expect(firstNameInput).toHaveValue('Jane');
  });

  it('allows editing last name in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-last-name')).toBeInTheDocument();
    });

    const lastNameInput = screen.getByTestId('window-edit-last-name');
    await user.clear(lastNameInput);
    await user.type(lastNameInput, 'Smith');

    expect(lastNameInput).toHaveValue('Smith');
  });

  it('allows editing birthday in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-birthday')).toBeInTheDocument();
    });

    const birthdayInput = screen.getByTestId('window-edit-birthday');
    await user.clear(birthdayInput);
    await user.type(birthdayInput, '2000-06-15');

    expect(birthdayInput).toHaveValue('2000-06-15');
  });

  it('shows error when saving with empty first name', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-first-name')).toBeInTheDocument();
    });

    const firstNameInput = screen.getByTestId('window-edit-first-name');
    await user.clear(firstNameInput);

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
    });
  });

  it('allows adding email in edit mode', async () => {
    const user = userEvent.setup();
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Email Addresses')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const emailAddButton = addButtons[0];
    if (emailAddButton) {
      await user.click(emailAddButton);
    }

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBeGreaterThan(0);
    });
  });

  it('allows adding phone in edit mode', async () => {
    const user = userEvent.setup();
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Phone Numbers')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const phoneAddButton = addButtons[addButtons.length - 1];
    if (phoneAddButton) {
      await user.click(phoneAddButton);
    }

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBeGreaterThan(0);
    });
  });

  it('allows editing email value in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBeGreaterThan(0);
    });

    const emailInputs = screen.getAllByPlaceholderText('Email');
    const emailInput = emailInputs[0];
    if (emailInput) {
      await user.clear(emailInput);
      await user.type(emailInput, 'updated@example.com');
      expect(emailInput).toHaveValue('updated@example.com');
    }
  });

  it('allows editing email label in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const labelInputs = screen.getAllByPlaceholderText('Label');
      expect(labelInputs.length).toBeGreaterThan(0);
    });

    const labelInputs = screen.getAllByPlaceholderText('Label');
    const labelInput = labelInputs[0];
    if (labelInput) {
      await user.clear(labelInput);
      await user.type(labelInput, 'Personal');
      expect(labelInput).toHaveValue('Personal');
    }
  });

  it('allows changing primary email', async () => {
    const user = userEvent.setup();
    const mockMultipleEmails = [
      { ...mockEmails[0], isPrimary: true },
      {
        id: 'email-2',
        contactId: 'contact-123',
        email: 'john2@example.com',
        label: 'Home',
        isPrimary: false
      }
    ];
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve(mockMultipleEmails);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBeGreaterThan(0);
    });

    const radioButtons = screen.getAllByRole('radio');
    const secondRadio = radioButtons[1];
    if (secondRadio) {
      await user.click(secondRadio);
    }
  });

  it('allows deleting email in edit mode', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(1);
    });

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg.lucide-trash-2'));
    if (deleteButtons[0]) {
      await user.click(deleteButtons[0]);
    }

    await waitFor(() => {
      const emailInputs = screen.queryAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(0);
    });
  });

  it('shows error when saving with empty email', async () => {
    const user = userEvent.setup();
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Email Addresses')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const emailAddButton = addButtons[0];
    if (emailAddButton) {
      await user.click(emailAddButton);
    }

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(
        screen.getByText('Email address cannot be empty')
      ).toBeInTheDocument();
    });
  });

  it('shows error when saving with empty phone', async () => {
    const user = userEvent.setup();
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Phone Numbers')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const phoneAddButton = addButtons[addButtons.length - 1];
    if (phoneAddButton) {
      await user.click(phoneAddButton);
    }

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(
        screen.getByText('Phone number cannot be empty')
      ).toBeInTheDocument();
    });
  });

  it('successfully saves contact changes', async () => {
    // Use empty emails and phones for simpler test
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-first-name')).toBeInTheDocument();
    });

    const firstNameInput = screen.getByTestId('window-edit-first-name');
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'Jane');

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('displays only first name when last name is null', async () => {
    const contactWithoutLastName = { ...mockContact, lastName: null };
    mockDb.limit.mockResolvedValue([contactWithoutLastName]);

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John')).toBeInTheDocument();
    });
  });

  it('does not display birthday when null', async () => {
    const contactWithoutBirthday = { ...mockContact, birthday: null };
    mockDb.limit.mockResolvedValue([contactWithoutBirthday]);

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    expect(screen.queryByText('1990-01-15')).not.toBeInTheDocument();
  });

  it('displays email without label correctly', async () => {
    const emailWithoutLabel = [{ ...mockEmails[0], label: null }];
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve(emailWithoutLabel);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    expect(screen.queryByText('(Work)')).not.toBeInTheDocument();
  });

  it('displays phone numbers correctly', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: 'Mobile',
        isPrimary: true
      }
    ];
    let callCount = 0;
    mockDb.orderBy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockEmails);
      return Promise.resolve(mockPhones);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });
  });

  it('allows editing phone value in edit mode', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: 'Mobile',
        isPrimary: true
      }
    ];
    let callCount = 0;
    mockDb.orderBy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve(mockPhones);
    });

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBeGreaterThan(0);
    });

    const phoneInputs = screen.getAllByPlaceholderText('Phone');
    const phoneInput = phoneInputs[0];
    if (phoneInput) {
      await user.clear(phoneInput);
      await user.type(phoneInput, '+9876543210');
      expect(phoneInput).toHaveValue('+9876543210');
    }
  });

  it('allows changing primary phone', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: 'Mobile',
        isPrimary: true
      },
      {
        id: 'phone-2',
        contactId: 'contact-123',
        phoneNumber: '+0987654321',
        label: 'Work',
        isPrimary: false
      }
    ];
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve(mockPhones);
    });

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBeGreaterThan(1);
    });

    const radioButtons = screen.getAllByRole('radio');
    const secondRadio = radioButtons[1];
    if (secondRadio) {
      await user.click(secondRadio);
    }
  });

  it('allows deleting phone in edit mode', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: 'Mobile',
        isPrimary: true
      }
    ];
    let callCount = 0;
    mockDb.orderBy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve(mockPhones);
    });

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(1);
    });

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg.lucide-trash-2'));
    if (deleteButtons[0]) {
      await user.click(deleteButtons[0]);
    }

    await waitFor(() => {
      const phoneInputs = screen.queryAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(0);
    });
  });

  it('handles delete error gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = mockConsoleError();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByTestId('window-contact-delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete contact:',
      expect.any(Error)
    );
  });

  it('handles save error gracefully', async () => {
    // Use empty emails and phones for simpler test
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });

    const user = userEvent.setup();
    const consoleSpy = mockConsoleError();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('window-edit-first-name')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Save failed'));

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to save contact:',
      expect.any(Error)
    );
  });

  it('saves contact with new email successfully', async () => {
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Email Addresses')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const emailAddButton = addButtons[0];
    if (emailAddButton) {
      await user.click(emailAddButton);
    }

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(1);
    });

    const emailInputs = screen.getAllByPlaceholderText('Email');
    const emailInput = emailInputs[0];
    if (emailInput) {
      await user.type(emailInput, 'test@example.com');
    }

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  it('saves contact with new phone successfully', async () => {
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve([]);
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-contact-edit'));

    await waitFor(() => {
      expect(screen.getByText('Phone Numbers')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    const phoneAddButton = addButtons[addButtons.length - 1];
    if (phoneAddButton) {
      await user.click(phoneAddButton);
    }

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(1);
    });

    const phoneInputs = screen.getAllByPlaceholderText('Phone');
    const phoneInput = phoneInputs[0];
    if (phoneInput) {
      await user.type(phoneInput, '+1234567890');
    }

    await user.click(screen.getByTestId('window-contact-save'));

    await waitFor(() => {
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<ContactsWindowDetail {...defaultProps} />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('displays phone without label correctly', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: null,
        isPrimary: false
      }
    ];
    let callCount = 0;
    mockDb.orderBy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve(mockPhones);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    expect(screen.queryByText('(Mobile)')).not.toBeInTheDocument();
  });

  it('displays non-primary email correctly', async () => {
    const mockNonPrimaryEmails = [
      {
        id: 'email-1',
        contactId: 'contact-123',
        email: 'john@example.com',
        label: 'Work',
        isPrimary: false
      }
    ];
    mockDb.orderBy.mockImplementation(() => {
      return Promise.resolve(mockNonPrimaryEmails);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
  });

  it('displays non-primary phone correctly', async () => {
    const mockPhones = [
      {
        id: 'phone-1',
        contactId: 'contact-123',
        phoneNumber: '+1234567890',
        label: 'Mobile',
        isPrimary: false
      }
    ];
    let callCount = 0;
    mockDb.orderBy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve(mockPhones);
    });

    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    const primaryBadges = screen.queryAllByText('Primary');
    expect(primaryBadges.length).toBe(0);
  });
});
