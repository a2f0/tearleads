import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugMenu } from './debug-menu';

vi.mock('@/lib/api', () => ({
  api: {
    health: {
      get: vi.fn(),
    },
  },
}));

import { api } from '@/lib/api';

const mockHealthData = {
  status: 'healthy',
  timestamp: '2025-01-01T00:00:00.000Z',
  uptime: 123.45,
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

    // Get the X button (the one with the icon, not the backdrop)
    const closeButtons = screen.getAllByRole('button', {
      name: /close debug menu/i,
    });
    const xButton = closeButtons.find(
      (btn) => !btn.classList.contains('bg-black/50')
    );
    if (xButton) {
      await user.click(xButton);
    }

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

    // Click the backdrop (the button with "Close debug menu" aria-label that covers the screen)
    const buttons = screen.getAllByRole('button', {
      name: /close debug menu/i,
    });
    const backdrop = buttons.find((btn) =>
      btn.classList.contains('bg-black/50')
    );
    if (backdrop) {
      await user.click(backdrop);
    }

    await waitFor(() => {
      expect(screen.queryByText('Debug Menu')).not.toBeInTheDocument();
    });
  });
});
