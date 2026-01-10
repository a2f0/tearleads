import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugMenu } from './debug-menu';

vi.mock('@/lib/api', () => ({
  api: {
    ping: {
      get: vi.fn()
    }
  },
  API_BASE_URL: 'https://api.example.com/v1'
}));

import { api } from '@/lib/api';

const mockPingData = {
  version: '0.0.2',
  dbVersion: '0.0.1'
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
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText('Debug Menu')).toBeInTheDocument();
    expect(screen.getByText(/environment/i)).toBeInTheDocument();
  });

  it('displays environment information', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText(/environment/i)).toBeInTheDocument();
    expect(screen.getByText(/screen/i)).toBeInTheDocument();
    expect(screen.getByText(/user agent/i)).toBeInTheDocument();
  });

  it('displays the API URL', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText(/api url/i)).toBeInTheDocument();
    expect(screen.getByText('https://api.example.com/v1')).toBeInTheDocument();
  });

  it('fetches and displays version when menu opens', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText('0.0.2')).toBeInTheDocument();
    });

    expect(api.ping.get).toHaveBeenCalled();
  });

  it('shows loading state while ping is in flight', async () => {
    const user = userEvent.setup();
    let resolvePing: (data: typeof mockPingData) => void = () => {};

    vi.mocked(api.ping.get).mockImplementation(
      () =>
        new Promise<typeof mockPingData>((resolve) => {
          resolvePing = resolve;
        })
    );

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    resolvePing(mockPingData);

    await waitFor(() => {
      expect(screen.getByText('0.0.2')).toBeInTheDocument();
    });
  });

  it('displays error when ping fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockRejectedValue(new Error('API error: 500'));

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to connect to api/i)).toBeInTheDocument();
    });
  });

  it('refreshes ping data when refresh button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

    render(<DebugMenu />);

    await user.click(screen.getByRole('button', { name: /open debug menu/i }));

    await waitFor(() => {
      expect(screen.getByText('0.0.2')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(api.ping.get).toHaveBeenCalledTimes(2);
    });
  });

  it('closes the menu when close button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

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
    vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

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

  describe('destructive actions', () => {
    it('throws an error when Throw Error button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(api.ping.get).mockResolvedValue(mockPingData);

      // Suppress error boundary console errors for this test
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<DebugMenu />);

      await user.click(
        screen.getByRole('button', { name: /open debug menu/i })
      );

      // Clicking this button should cause the component to throw
      await expect(async () => {
        await user.click(screen.getByTestId('throw-error-button'));
      }).rejects.toThrow('Test error from debug menu');
    });
  });
});
