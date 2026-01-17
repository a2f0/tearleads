import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Email } from './Email';

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:5001/v1'
}));

vi.mock('@/components/ui/refresh-button', () => ({
  RefreshButton: ({
    onClick,
    loading
  }: {
    onClick: () => void;
    loading: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-testid="refresh-button"
      data-loading={loading}
    >
      Refresh
    </button>
  )
}));

const mockEmails = [
  {
    id: 'email-1',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Email Subject',
    receivedAt: '2024-01-15T10:00:00Z',
    size: 2048
  }
];

describe('Email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const renderWithRouter = (component: React.ReactNode) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders email list after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithRouter(<Email />);

    await waitFor(() => {
      expect(screen.getByText('Test Email Subject')).toBeInTheDocument();
    });

    expect(screen.getByText(/From: sender@example.com/)).toBeInTheDocument();
  });

  it('renders empty state when no emails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithRouter(<Email />);

    await waitFor(() => {
      expect(screen.getByText('No emails yet')).toBeInTheDocument();
    });
  });

  it('renders error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });

    renderWithRouter(<Email />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch emails/)).toBeInTheDocument();
    });
  });

  it('renders page title and refresh button', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithRouter(<Email />);

    expect(screen.getByRole('heading', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No emails yet')).toBeInTheDocument();
    });
  });
});
