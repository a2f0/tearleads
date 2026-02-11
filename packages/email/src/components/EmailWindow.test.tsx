import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailContactOperations, EmailFolderOperations } from '../context';
import { mockConsoleError } from '../test/console-mocks';
import { TestEmailProvider } from '../test/test-utils';
import { EmailWindow } from './EmailWindow';

vi.mock('@rapid/window-manager', () => ({
  WINDOW_TABLE_TYPOGRAPHY: {
    table: 'w-full text-left text-xs',
    header: 'sticky top-0 border-b bg-muted/50 text-muted-foreground',
    headerCell: 'px-2 py-1.5 text-left font-medium',
    cell: 'px-2 py-1.5',
    mutedCell: 'px-2 py-1.5 text-muted-foreground'
  },
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  ),
  useResizableSidebar: () => ({
    resizeHandleProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuenow': 180,
      'aria-valuemin': 150,
      'aria-valuemax': 400,
      'aria-label': 'Resize sidebar',
      onMouseDown: vi.fn(),
      onKeyDown: vi.fn()
    }
  }),
  WindowTableRow: ({
    children,
    isDimmed: _isDimmed,
    isSelected: _isSelected,
    ...props
  }: {
    children: React.ReactNode;
    isDimmed?: boolean;
    isSelected?: boolean;
  } & React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  )
}));

vi.mock('./EmailWindowMenuBar', () => ({
  EmailWindowMenuBar: ({
    viewMode,
    onViewModeChange,
    onRefresh,
    onCompose
  }: {
    viewMode: string;
    onViewModeChange: (mode: 'list' | 'table') => void;
    onRefresh: () => void;
    onCompose: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="current-view-mode">{viewMode}</span>
      <button type="button" onClick={onCompose} data-testid="compose">
        Compose
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="switch-to-table"
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('list')}
        data-testid="switch-to-list"
      >
        List
      </button>
      <button type="button" onClick={onRefresh} data-testid="refresh">
        Refresh
      </button>
    </div>
  )
}));

const mockEmails = [
  {
    id: 'email-1',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Subject',
    receivedAt: '2024-01-15T10:00:00Z',
    size: 1024
  }
];

const mockEmailLargeSize = {
  id: 'email-2',
  from: 'large@example.com',
  to: ['recipient@example.com'],
  subject: 'Large Email',
  receivedAt: '2024-01-15T11:00:00Z',
  size: 2 * 1024 * 1024
};

const mockEmailSmallSize = {
  id: 'email-3',
  from: 'small@example.com',
  to: ['recipient@example.com'],
  subject: 'Small Email',
  receivedAt: '2024-01-15T12:00:00Z',
  size: 500
};

const mockFolderOperations: EmailFolderOperations = {
  fetchFolders: vi.fn().mockResolvedValue([
    {
      id: 'folder-inbox',
      name: 'Inbox',
      folderType: 'inbox',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-sent',
      name: 'Sent',
      folderType: 'sent',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-trash',
      name: 'Trash',
      folderType: 'trash',
      parentId: null,
      unreadCount: 0
    }
  ]),
  createFolder: vi.fn().mockResolvedValue({
    id: 'new-folder',
    name: 'New Folder',
    folderType: 'custom',
    parentId: null,
    unreadCount: 0
  }),
  renameFolder: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  moveFolder: vi.fn().mockResolvedValue(undefined),
  initializeSystemFolders: vi.fn().mockResolvedValue(undefined),
  getFolderByType: vi.fn().mockResolvedValue(null)
};

describe('EmailWindow', () => {
  const defaultProps: ComponentProps<typeof EmailWindow> = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  const renderWithProvider = (
    props: ComponentProps<typeof EmailWindow> = defaultProps,
    options?: {
      contactOperations?: EmailContactOperations;
      folderOperations?: EmailFolderOperations;
    }
  ) => {
    return render(
      <TestEmailProvider
        {...(options?.contactOperations && {
          contactOperations: options.contactOperations
        })}
        {...(options?.folderOperations && {
          folderOperations: options.folderOperations
        })}
      >
        <EmailWindow {...props} />
      </TestEmailProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const renderLoadedWindow = async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });
    renderWithProvider();
    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });
  };

  it('renders with loading state initially', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    renderWithProvider();

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('All Mail');
  });

  it('displays emails after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    expect(screen.getByText('sender@example.com')).toBeInTheDocument();
  });

  it('displays empty state when no emails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('No emails yet')).toBeInTheDocument();
    });
  });

  it('displays error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });
    const consoleSpy = mockConsoleError();

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch emails/)).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch emails:',
      expect.any(Error)
    );
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithProvider();

    await user.click(screen.getByTestId('close-window'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows email detail view when email is clicked', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Subject'));

    await waitFor(() => {
      expect(screen.getByText(/Back to Inbox/)).toBeInTheDocument();
    });

    expect(screen.getByText('From: sender@example.com')).toBeInTheDocument();
    expect(screen.getByText('To: recipient@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Email');
  });

  it('returns to list view when back button is clicked', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Subject'));

    await waitFor(() => {
      expect(screen.getByText(/Back to Inbox/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Back to Inbox/));

    await waitFor(() => {
      expect(screen.getByTestId('window-title')).toHaveTextContent('All Mail');
    });

    expect(screen.queryByText(/Back to Inbox/)).not.toBeInTheDocument();
  });

  it('renders table view when view mode is switched', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('switch-to-table'));

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('columnheader', { name: 'Subject' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'From' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Date' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Size' })
    ).toBeInTheDocument();
  });

  it('displays email data in table view', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('switch-to-table'));

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Test Subject');
    expect(cells[1]).toHaveTextContent('sender@example.com');
  });

  it('displays size in MB for large files', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [mockEmailLargeSize] })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Large Email')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Large Email'));

    await waitFor(() => {
      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });
  });

  it('displays size in bytes for small files', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [mockEmailSmallSize] })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Small Email')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Small Email'));

    await waitFor(() => {
      expect(screen.getByText(/500 B/)).toBeInTheDocument();
    });
  });

  it('keeps menu bar when email is selected', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Subject'));

    await waitFor(() => {
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });
  });

  it('opens compose in the main panel tab', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('compose'));

    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'New Message' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('window-title')).toHaveTextContent('New Message');
    expect(screen.queryByText('Test Subject')).not.toBeInTheDocument();
  });

  it('opens compose with recipients from open request', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider({
      ...defaultProps,
      openComposeRequest: {
        to: ['ada@example.com', 'grace@example.com'],
        requestId: 1
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'New Message' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('compose-to')).toHaveValue(
      'ada@example.com, grace@example.com'
    );
  });

  it('closes compose tab from close button', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();

    await user.click(screen.getByTestId('compose'));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('compose-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    });

    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All Mail' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });

  it('switches between inbox and compose tabs', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();

    await user.click(screen.getByTestId('compose'));
    await user.click(screen.getByRole('tab', { name: 'New Message' }));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'All Mail' }));
    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'New Message' })
    ).toBeInTheDocument();
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });

  it('closes compose tab from tab close button', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();

    await user.click(screen.getByTestId('compose'));
    expect(
      screen.getByRole('tab', { name: 'New Message' })
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('email-tab-compose-close'));

    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All Mail' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('disables autofill for compose address fields', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();

    await user.click(screen.getByTestId('compose'));

    expect(screen.getByTestId('compose-to')).toHaveAttribute(
      'autocomplete',
      'off'
    );
    expect(screen.getByTestId('compose-cc')).toHaveAttribute(
      'autocomplete',
      'off'
    );
    expect(screen.getByTestId('compose-bcc')).toHaveAttribute(
      'autocomplete',
      'off'
    );
  });

  it('adds address-book contacts to recipient fields from compose', async () => {
    const user = userEvent.setup();
    const contactOperations: EmailContactOperations = {
      fetchContactEmails: vi.fn().mockResolvedValue([
        {
          contactId: 'contact-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          label: 'Work',
          isPrimary: true
        }
      ])
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });
    renderWithProvider(defaultProps, { contactOperations });

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('compose'));

    expect(screen.queryByTestId('address-book-picker')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('compose-to-address-book'));
    await waitFor(() => {
      expect(screen.getByTestId('address-book-picker')).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to to/i })
    );
    expect(screen.getByTestId('compose-to')).toHaveValue('ada@example.com');

    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to cc/i })
    );
    expect(screen.getByTestId('compose-cc')).toHaveValue('ada@example.com');

    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to bcc/i })
    );
    expect(screen.getByTestId('compose-bcc')).toHaveValue('ada@example.com');

    await user.click(screen.getByTestId('address-book-close'));
    expect(screen.queryByTestId('address-book-picker')).not.toBeInTheDocument();
  });

  it('switches right panel when selecting Sent folder', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider(defaultProps, {
      folderOperations: mockFolderOperations
    });

    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Sent'));

    await waitFor(() => {
      expect(screen.getByText('No emails in Sent')).toBeInTheDocument();
    });
    expect(screen.getByTestId('window-title')).toHaveTextContent('Sent');
  });
});
