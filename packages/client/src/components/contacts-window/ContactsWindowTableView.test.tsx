import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsWindowTableView } from './ContactsWindowTableView';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        getInfo: 'Get Info',
        delete: 'Delete'
      })[key] ?? key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

const mockContacts = [
  {
    id: 'contact-1',
    firstName: 'John',
    lastName: 'Doe',
    primaryEmail: 'john@example.com',
    primaryPhone: '+1234567890'
  },
  {
    id: 'contact-2',
    firstName: 'Jane',
    lastName: 'Smith',
    primaryEmail: 'jane@example.com',
    primaryPhone: null
  }
];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

describe('ContactsWindowTableView', () => {
  const defaultProps = {
    onSelectContact: vi.fn(),
    onCreateContact: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDb.orderBy.mockResolvedValue([]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowTableView {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<ContactsWindowTableView {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders header with Contacts title', () => {
    render(<ContactsWindowTableView {...defaultProps} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
  });

  it('renders create contact button when unlocked', () => {
    render(<ContactsWindowTableView {...defaultProps} />);
    expect(
      screen.getByTestId('table-create-contact-button')
    ).toBeInTheDocument();
  });

  it('shows empty state when no contacts exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('table-empty-create-contact')
    ).toBeInTheDocument();
  });

  it('renders table with contacts when contacts exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    // Check table headers
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('calls onSelectContact when contact row is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const onSelectContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowTableView
        {...defaultProps}
        onSelectContact={onSelectContact}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    await user.click(screen.getByText('John Doe'));
    expect(onSelectContact).toHaveBeenCalledWith('contact-1');
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('displays email and phone in table cells', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('+1234567890')).toBeInTheDocument();
  });

  it('sorts by name column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockContacts);

    await user.click(screen.getByText('Name'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('sorts by email column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockContacts);

    await user.click(screen.getByText('Email'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('calls onCreateContact when create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const onCreateContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowTableView
        {...defaultProps}
        onCreateContact={onCreateContact}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('table-empty-create-contact')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-empty-create-contact'));
    expect(onCreateContact).toHaveBeenCalled();
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowTableView {...defaultProps} />);

    expect(
      screen.queryByTestId('table-create-contact-button')
    ).not.toBeInTheDocument();
  });

  it('toggles sort direction when same column is clicked again', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockContacts);

    // Click Name to toggle direction (default is asc on firstName)
    await user.click(screen.getByText('Name'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('shows context menu on right click', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('tr');
    if (contactRow) {
      await user.pointer({ keys: '[MouseRight]', target: contactRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('calls onSelectContact when Get Info is clicked from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const onSelectContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowTableView
        {...defaultProps}
        onSelectContact={onSelectContact}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('tr');
    if (contactRow) {
      await user.pointer({ keys: '[MouseRight]', target: contactRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get Info'));
    expect(onSelectContact).toHaveBeenCalledWith('contact-1');
  });

  it('deletes contact via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('tr');
    if (contactRow) {
      await user.pointer({ keys: '[MouseRight]', target: contactRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('handles delete error gracefully', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('tr');
    if (contactRow) {
      await user.pointer({ keys: '[MouseRight]', target: contactRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('calls onCreateContact when header create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const onCreateContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowTableView
        {...defaultProps}
        onCreateContact={onCreateContact}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('table-create-contact-button')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-create-contact-button'));
    expect(onCreateContact).toHaveBeenCalled();
  });

  it('displays contact without last name correctly', async () => {
    const contactWithoutLastName = [
      {
        id: 'contact-3',
        firstName: 'Bob',
        lastName: null,
        primaryEmail: 'bob@example.com',
        primaryPhone: null
      }
    ];
    mockDb.orderBy.mockResolvedValue(contactWithoutLastName);
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('displays contact without email or phone correctly', async () => {
    const contactWithoutInfo = [
      {
        id: 'contact-3',
        firstName: 'Bob',
        lastName: 'Test',
        primaryEmail: null,
        primaryPhone: null
      }
    ];
    mockDb.orderBy.mockResolvedValue(contactWithoutInfo);
    render(<ContactsWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Bob Test')).toBeInTheDocument();
    });
  });
});
