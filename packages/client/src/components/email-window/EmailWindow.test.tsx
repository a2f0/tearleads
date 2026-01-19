import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { EmailWindow } from './EmailWindow';

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:5001/v1'
}));

vi.mock('@/components/floating-window', () => ({
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
    onRefresh
  }: {
    viewMode: string;
    onViewModeChange: (mode: 'list' | 'table') => void;
    onRefresh: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="current-view-mode">{viewMode}</span>
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

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders with loading state initially', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<EmailWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Inbox');
  });

  it('displays emails after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

    await user.click(screen.getByTestId('close-window'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows email detail view when email is clicked', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

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

    render(<EmailWindow {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Subject'));

    await waitFor(() => {
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });
  });
});
