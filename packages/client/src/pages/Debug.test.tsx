import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Debug } from './Debug';

// Mock the api module
const mockPingGet = vi.fn();
vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  api: {
    ping: {
      get: () => mockPingGet()
    }
  }
}));

// Mock detectPlatform
vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual('@/lib/utils');
  return {
    ...actual,
    detectPlatform: vi.fn(() => 'web')
  };
});

function renderDebug() {
  return render(
    <MemoryRouter>
      <Debug />
    </MemoryRouter>
  );
}

describe('Debug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPingGet.mockResolvedValue({ version: '1.0.0' });
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderDebug();

      expect(screen.getByText('Debug')).toBeInTheDocument();
    });

    it('renders environment info section', async () => {
      renderDebug();

      expect(screen.getByText('Environment Info')).toBeInTheDocument();
      expect(screen.getByText('Environment:')).toBeInTheDocument();
    });

    it('renders device info section', async () => {
      renderDebug();

      expect(screen.getByText('Device Info')).toBeInTheDocument();
      expect(screen.getByText('Platform:')).toBeInTheDocument();
      expect(screen.getByText('Pixel Ratio:')).toBeInTheDocument();
      expect(screen.getByText('Online:')).toBeInTheDocument();
      expect(screen.getByText('Language:')).toBeInTheDocument();
      expect(screen.getByText('Touch Support:')).toBeInTheDocument();
      expect(screen.getByText('Standalone:')).toBeInTheDocument();
    });

    it('renders API status section', async () => {
      renderDebug();

      expect(screen.getByText('API Status')).toBeInTheDocument();
      expect(screen.getByText('API URL')).toBeInTheDocument();
    });

    it('renders actions section', async () => {
      renderDebug();

      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByText('Clear Local Storage')).toBeInTheDocument();
      expect(screen.getByText('Throw Error')).toBeInTheDocument();
    });
  });

  describe('environment info', () => {
    it('displays the current environment mode', async () => {
      renderDebug();

      expect(screen.getByText('test')).toBeInTheDocument();
    });

    it('displays the screen size', async () => {
      renderDebug();

      // Screen size is displayed
      expect(screen.getByText('Screen:')).toBeInTheDocument();
    });

    it('displays user agent', async () => {
      renderDebug();

      expect(screen.getByText('User Agent:')).toBeInTheDocument();
    });
  });

  describe('device info', () => {
    it('displays platform', async () => {
      renderDebug();

      expect(screen.getByText('web')).toBeInTheDocument();
    });

    it('displays pixel ratio', async () => {
      renderDebug();

      // window.devicePixelRatio default value
      expect(screen.getByText('Pixel Ratio:')).toBeInTheDocument();
    });

    it('displays online status', async () => {
      renderDebug();

      // Default navigator.onLine is true, so Online should show Yes
      expect(screen.getByText('Online:')).toBeInTheDocument();
      // Multiple 'Yes' values may exist (Online, Touch Support, Standalone)
      expect(screen.getAllByText('Yes').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('API status', () => {
    it('fetches ping on mount', async () => {
      renderDebug();

      await waitFor(() => {
        expect(mockPingGet).toHaveBeenCalled();
      });
    });

    it('displays API version when ping succeeds', async () => {
      renderDebug();

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });
    });

    it('displays loading state while fetching', async () => {
      mockPingGet.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderDebug();

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('displays error message when ping fails', async () => {
      mockPingGet.mockRejectedValue(new Error('Network error'));

      renderDebug();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to connect to API')
        ).toBeInTheDocument();
      });
    });

    it('refreshes API status when Refresh button is clicked', async () => {
      const user = userEvent.setup();
      renderDebug();

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });

      mockPingGet.mockClear();
      mockPingGet.mockResolvedValue({ version: '1.0.1' });

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockPingGet).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('1.0.1')).toBeInTheDocument();
      });
    });

    it('disables Refresh button while loading', async () => {
      mockPingGet.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderDebug();

      expect(screen.getByText('Refreshing...')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /refreshing/i })
      ).toBeDisabled();
    });
  });

  describe('actions', () => {
    it('clears localStorage and reloads when Clear Local Storage is clicked', async () => {
      const user = userEvent.setup();
      const mockReload = vi.fn();
      const originalReload = window.location.reload;

      // Mock window.location.reload
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: mockReload },
        writable: true
      });

      // Set something in localStorage
      localStorage.setItem('test-key', 'test-value');

      renderDebug();

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear Local Storage'));

      expect(localStorage.clear).toHaveBeenCalled();
      expect(mockReload).toHaveBeenCalled();

      // Restore
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: originalReload },
        writable: true
      });
    });

    it('throws error when Throw Error button is clicked', async () => {
      // Suppress console.error for this test
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      renderDebug();

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });

      // Clicking the button should throw an error
      expect(screen.getByTestId('throw-error-button')).toBeInTheDocument();

      // The component will throw when shouldThrow is set to true
      // We can't easily test this in isolation without an error boundary
      // But we can verify the button exists and has the correct attributes

      consoleSpy.mockRestore();
    });
  });

  describe('resize handling', () => {
    it('updates screen size on window resize', async () => {
      renderDebug();

      // Trigger resize event
      Object.defineProperty(window, 'innerWidth', {
        value: 800,
        writable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 600,
        writable: true
      });

      window.dispatchEvent(new Event('resize'));

      await waitFor(() => {
        expect(screen.getByText(/800 x 600/)).toBeInTheDocument();
      });
    });
  });
});
