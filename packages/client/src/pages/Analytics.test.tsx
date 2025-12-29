import { ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Analytics } from './Analytics';

// Track how many times getEvents is called to detect infinite loops
let getEventsCallCount = 0;
let getEventStatsCallCount = 0;

// Mock database context
const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock getDatabase
const mockDb = {};
vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

// Mock analytics functions
const mockGetEvents = vi.fn();
const mockGetEventStats = vi.fn();
const mockClearEvents = vi.fn();

vi.mock('@/db/analytics', () => ({
  getEvents: (...args: unknown[]) => {
    getEventsCallCount++;
    return mockGetEvents(...args);
  },
  getEventStats: (...args: unknown[]) => {
    getEventStatsCallCount++;
    return mockGetEventStats(...args);
  },
  clearEvents: (...args: unknown[]) => mockClearEvents(...args)
}));

function renderAnalytics() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Analytics />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventsCallCount = 0;
    getEventStatsCallCount = 0;

    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue([]);
    mockClearEvents.mockResolvedValue(undefined);
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
    });

    it('shows loading message', () => {
      renderAnalytics();
      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not fetch analytics data', () => {
      renderAnalytics();
      expect(mockGetEvents).not.toHaveBeenCalled();
      expect(mockGetEventStats).not.toHaveBeenCalled();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
    });

    it('shows locked message', () => {
      renderAnalytics();
      expect(
        screen.getByText(
          'Database is locked. Unlock it from the SQLite page to view analytics.'
        )
      ).toBeInTheDocument();
    });

    it('does not fetch analytics data', () => {
      renderAnalytics();
      expect(mockGetEvents).not.toHaveBeenCalled();
      expect(mockGetEventStats).not.toHaveBeenCalled();
    });
  });

  describe('when database is unlocked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
    });

    it('renders the analytics title', async () => {
      renderAnalytics();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });

    it('fetches analytics data on mount', async () => {
      renderAnalytics();

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
        expect(mockGetEventStats).toHaveBeenCalledTimes(1);
      });
    });

    it('does not cause infinite re-fetches', async () => {
      renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalled();
      });

      // Wait a bit to ensure no additional fetches occur
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Should only have fetched once, not multiple times
      expect(getEventsCallCount).toBe(1);
      expect(getEventStatsCallCount).toBe(1);
    });

    it('shows empty state when no events exist', async () => {
      mockGetEvents.mockResolvedValue([]);
      mockGetEventStats.mockResolvedValue([]);

      renderAnalytics();

      await waitFor(() => {
        expect(
          screen.getByText(
            'No events recorded yet. Events will appear here after database operations.'
          )
        ).toBeInTheDocument();
      });
    });

    it('displays events when data is fetched', async () => {
      const mockEvents = [
        {
          id: '1',
          eventName: 'db_setup',
          durationMs: 150,
          success: true,
          timestamp: new Date('2025-01-01T12:00:00Z')
        }
      ];
      const mockStats = [
        {
          eventName: 'db_setup',
          count: 1,
          avgDurationMs: 150,
          minDurationMs: 150,
          maxDurationMs: 150,
          successRate: 100
        }
      ];

      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetEventStats.mockResolvedValue(mockStats);

      renderAnalytics();

      await waitFor(() => {
        // Event name appears in both summary and table, so use getAllByText
        const setupElements = screen.getAllByText('Setup');
        expect(setupElements.length).toBeGreaterThan(0);
      });
    });

    it('renders time filter buttons', () => {
      renderAnalytics();

      expect(screen.getByText('Last Hour')).toBeInTheDocument();
      expect(screen.getByText('Last 24h')).toBeInTheDocument();
      expect(screen.getByText('Last Week')).toBeInTheDocument();
      expect(screen.getByText('All Time')).toBeInTheDocument();
    });

    it('refetches data when time filter changes', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click a different time filter
      await user.click(screen.getByText('Last Hour'));

      // Should fetch again with new filter
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2);
      });
    });

    it('refetches data when refresh button is clicked', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click refresh button
      await user.click(screen.getByText('Refresh'));

      // Should fetch again
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2);
      });
    });

    it('clears events when clear button is clicked', async () => {
      const user = userEvent.setup();

      const mockEvents = [
        {
          id: '1',
          eventName: 'db_setup',
          durationMs: 150,
          success: true,
          timestamp: new Date('2025-01-01T12:00:00Z')
        }
      ];

      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetEventStats.mockResolvedValue([
        {
          eventName: 'db_setup',
          count: 1,
          avgDurationMs: 150,
          minDurationMs: 150,
          maxDurationMs: 150,
          successRate: 100
        }
      ]);

      renderAnalytics();

      // Wait for events to load
      await waitFor(() => {
        const setupElements = screen.getAllByText('Setup');
        expect(setupElements.length).toBeGreaterThan(0);
      });

      // Click clear button
      await user.click(screen.getByText('Clear'));

      await waitFor(() => {
        expect(mockClearEvents).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('stability under rapid re-renders', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
    });

    it('does not fetch more than expected even with multiple renders', async () => {
      const { rerender } = render(
        <MemoryRouter>
          <ThemeProvider>
            <Analytics />
          </ThemeProvider>
        </MemoryRouter>
      );

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalled();
      });

      // Force multiple re-renders
      for (let i = 0; i < 5; i++) {
        rerender(
          <MemoryRouter>
            <ThemeProvider>
              <Analytics />
            </ThemeProvider>
          </MemoryRouter>
        );
      }

      // Wait a bit to see if any additional fetches happen
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Should still only have 1 fetch, not 6
      expect(getEventsCallCount).toBe(1);
      expect(getEventStatsCallCount).toBe(1);
    });
  });
});
