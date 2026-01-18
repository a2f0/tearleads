import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { ContactsWindowList } from './ContactsWindowList';

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

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  })
}));

describe('ContactsWindowList', () => {
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
    render(<ContactsWindowList {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<ContactsWindowList {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders container element', () => {
    const { container } = render(<ContactsWindowList {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders header with Contacts title', () => {
    render(<ContactsWindowList {...defaultProps} />);
    expect(screen.getByText('Contacts')).toBeInTheDocument();
  });

  it('renders create contact button when unlocked', () => {
    render(<ContactsWindowList {...defaultProps} />);
    expect(
      screen.getByTestId('window-create-contact-button')
    ).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    render(<ContactsWindowList {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it('shows empty state when no contacts exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('window-empty-create-contact')
    ).toBeInTheDocument();
  });

  it('renders contacts list when contacts exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('renders search input when contacts exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('window-contacts-search')).toBeInTheDocument();
    });
  });

  it('filters contacts by search query', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-contacts-search');
    await user.type(searchInput, 'Jane');

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('calls onSelectContact when contact is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const onSelectContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowList {...defaultProps} onSelectContact={onSelectContact} />
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    await user.click(screen.getByText('John Doe'));
    expect(onSelectContact).toHaveBeenCalledWith('contact-1');
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    const consoleSpy = mockConsoleError();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch contacts:',
      expect.any(Error)
    );
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowList {...defaultProps} />);

    expect(
      screen.queryByTestId('window-create-contact-button')
    ).not.toBeInTheDocument();
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowList {...defaultProps} />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('displays email and phone for contacts', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('+1234567890')).toBeInTheDocument();
  });

  it('calls onCreateContact when create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const onCreateContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowList {...defaultProps} onCreateContact={onCreateContact} />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('window-empty-create-contact')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-empty-create-contact'));
    expect(onCreateContact).toHaveBeenCalled();
  });

  it('handles search query clearing', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-contacts-search');
    await user.type(searchInput, 'Jane');

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('shows context menu on right click', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('button');
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
      <ContactsWindowList {...defaultProps} onSelectContact={onSelectContact} />
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('button');
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
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('button');
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
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const contactRow = screen.getByText('John Doe').closest('button');
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

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete contact:',
      expect.any(Error)
    );
  });

  it('filters contacts by phone number', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-contacts-search');
    await user.type(searchInput, '1234567890');

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
  });

  it('filters contacts by email', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const user = userEvent.setup();
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-contacts-search');
    await user.type(searchInput, 'jane@');

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('displays No contact info for contacts without email or phone', async () => {
    const contactWithoutInfo = [
      {
        id: 'contact-3',
        firstName: 'Bob',
        lastName: null,
        primaryEmail: null,
        primaryPhone: null
      }
    ];
    mockDb.orderBy.mockResolvedValue(contactWithoutInfo);
    render(<ContactsWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    expect(screen.getByText('No contact info')).toBeInTheDocument();
  });

  it('calls onCreateContact when header create button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockContacts);
    const onCreateContact = vi.fn();
    const user = userEvent.setup();
    render(
      <ContactsWindowList {...defaultProps} onCreateContact={onCreateContact} />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('window-create-contact-button')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-create-contact-button'));
    expect(onCreateContact).toHaveBeenCalled();
  });
});
