import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugMenu } from './debug-menu';

vi.mock('@/lib/api', () => ({
  api: {
    health: {
      get: vi.fn()
    }
  }
}));

import { api } from '@/lib/api';

const mockHealthData = {
  status: 'healthy' as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  uptime: 123.45
};

describe('DebugMenu', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the debug button', () => {
    render(<DebugMenu />);
    expect(
      screen.getByRole('button', { name: /open debug menu/i })
    ).toBeInTheDocument();
  });

  it('opens the menu when debug button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText('Debug Menu')).toBeInTheDocument();
    expect(screen.getByText(/environment/i)).toBeInTheDocument();
  });

  it('displays environment information', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText(/environment/i)).toBeInTheDocument();
    expect(screen.getByText(/screen/i)).toBeInTheDocument();
    expect(screen.getByText(/user agent/i)).toBeInTheDocument();
  });

  it('fetches and displays health data when menu opens', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    expect(screen.getByText('123.45s')).toBeInTheDocument();
    expect(api.health.get).toHaveBeenCalled();
  });

  it('displays error when health check fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockRejectedValue(new Error('API error: 500'));

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to connect to api/i)).toBeInTheDocument();
    });
  });

  it('refreshes health data when refresh button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(api.health.get).toHaveBeenCalledTimes(2);
    });
  });

  it('closes the menu when close button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));
    expect(screen.getByText('Debug Menu')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /close debug menu button/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Debug Menu')).not.toBeInTheDocument();
    });
  });

  it('closes the menu when backdrop is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.health.get).mockResolvedValue(mockHealthData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));
    expect(screen.getByText('Debug Menu')).toBeInTheDocument();

    // Click the backdrop (uses "Close debug menu" aria-label, distinct from the button)
    await user.click(
      screen.getByRole('button', { name: /^close debug menu$/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Debug Menu')).not.toBeInTheDocument();
    });
  });
});
