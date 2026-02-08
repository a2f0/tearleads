import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '../test/console-mocks';
import { TestEmailProvider } from '../test/test-utils';
import { EmailWindow } from './EmailWindow';

vi.mock('@rapid/window-manager', () => ({
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

describe('EmailWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  const renderWithProvider = (props = defaultProps) => {
    return render(
      <TestEmailProvider>
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
    expect(screen.getByTestId('window-title')).toHaveTextContent('Inbox');
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
      expect(screen.getByTestId('window-title')).toHaveTextContent('Inbox');
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
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute(
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

    await user.click(screen.getByRole('tab', { name: 'Inbox' }));
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
    expect(screen.getByRole('tab', { name: 'New Message' })).toBeInTheDocument();

    await user.click(screen.getByTestId('email-tab-compose-close'));

    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute(
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
});
