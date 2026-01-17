import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('renders back button', () => {
    render(<ContactsWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('window-contact-back')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ContactsWindowDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-contact-back'));
    expect(onBack).toHaveBeenCalled();
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
    render(<ContactsWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
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
});
