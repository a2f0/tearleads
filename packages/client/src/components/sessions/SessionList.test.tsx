import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from './SessionList';

const mockGetSessions = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      getSessions: () => mockGetSessions(),
      deleteSession: (sessionId: string) => mockDeleteSession(sessionId)
    }
  }
}));

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetSessions.mockReturnValue(new Promise(() => {}));

    render(<SessionList />);

    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    mockGetSessions.mockRejectedValue(new Error('Network error'));

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows empty state when no sessions', async () => {
    mockGetSessions.mockResolvedValue({ sessions: [] });

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('No active sessions')).toBeInTheDocument();
    });
  });

  it('renders sessions list', async () => {
    const sessions = [
      {
        id: 'session-1',
        createdAt: new Date(Date.now() - 60000).toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1',
        isCurrent: true
      },
      {
        id: 'session-2',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        lastActiveAt: new Date(Date.now() - 1800000).toISOString(),
        ipAddress: '192.168.1.1',
        isCurrent: false
      }
    ];

    mockGetSessions.mockResolvedValue({ sessions });

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
    });

    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows delete button only for non-current sessions', async () => {
    const sessions = [
      {
        id: 'session-1',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1',
        isCurrent: true
      },
      {
        id: 'session-2',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '192.168.1.1',
        isCurrent: false
      }
    ];

    mockGetSessions.mockResolvedValue({ sessions });

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', {
      name: 'Revoke session'
    });
    expect(deleteButtons).toHaveLength(1);
  });

  it('deletes session when delete button is clicked', async () => {
    const user = userEvent.setup();
    const sessions = [
      {
        id: 'session-1',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1',
        isCurrent: true
      },
      {
        id: 'session-2',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '192.168.1.1',
        isCurrent: false
      }
    ];

    mockGetSessions.mockResolvedValue({ sessions });
    mockDeleteSession.mockResolvedValue({ deleted: true });

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: 'Revoke session' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith('session-2');
    });

    expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
  });

  it('shows error when delete fails', async () => {
    const user = userEvent.setup();
    const sessions = [
      {
        id: 'session-1',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '127.0.0.1',
        isCurrent: true
      },
      {
        id: 'session-2',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ipAddress: '192.168.1.1',
        isCurrent: false
      }
    ];

    mockGetSessions.mockResolvedValue({ sessions });
    mockDeleteSession.mockRejectedValue(new Error('Delete failed'));

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: 'Revoke session' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(mockDeleteSession).toHaveBeenCalledWith('session-2');
  });

  it('retries fetch when retry button is clicked', async () => {
    const user = userEvent.setup();
    mockGetSessions.mockRejectedValueOnce(new Error('Network error'));
    mockGetSessions.mockResolvedValueOnce({
      sessions: [
        {
          id: 'session-1',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          ipAddress: '127.0.0.1',
          isCurrent: true
        }
      ]
    });

    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
    });

    expect(mockGetSessions).toHaveBeenCalledTimes(2);
  });
});
