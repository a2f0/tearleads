import { ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@/db/analytics';
import { Analytics, type SortState, sortEvents } from './Analytics';

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

    it('displays yellow success rate color for rates between 70-89%', async () => {
      const mockStats = [
        {
          eventName: 'db_setup',
          count: 10,
          avgDurationMs: 150,
          minDurationMs: 100,
          maxDurationMs: 200,
          successRate: 75
        }
      ];

      mockGetEvents.mockResolvedValue([]);
      mockGetEventStats.mockResolvedValue(mockStats);

      renderAnalytics();

      await waitFor(() => {
        const successRateElement = screen.getByText('75%');
        expect(successRateElement).toHaveClass('text-yellow-600');
      });
    });

    it('displays red success rate color for rates below 70%', async () => {
      const mockStats = [
        {
          eventName: 'db_setup',
          count: 10,
          avgDurationMs: 150,
          minDurationMs: 100,
          maxDurationMs: 200,
          successRate: 50
        }
      ];

      mockGetEvents.mockResolvedValue([]);
      mockGetEventStats.mockResolvedValue(mockStats);

      renderAnalytics();

      await waitFor(() => {
        const successRateElement = screen.getByText('50%');
        expect(successRateElement).toHaveClass('text-red-600');
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

    it('fetches all events when All Time filter is selected', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click All Time filter
      await user.click(screen.getByText('All Time'));

      // Should fetch again with no time filter (startTime undefined)
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2);
        expect(mockGetEvents).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ startTime: undefined })
        );
      });
    });

    it('fetches events when Last Week filter is selected', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click Last Week filter
      await user.click(screen.getByText('Last Week'));

      // Should fetch again with week time filter
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2);
        expect(mockGetEvents).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({
            startTime: expect.any(Date)
          })
        );
      });
    });

    it('displays error when fetch fails', async () => {
      mockGetEvents.mockRejectedValueOnce(new Error('Fetch failed'));

      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByText('Fetch failed')).toBeInTheDocument();
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

    it('displays error when clear fails', async () => {
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
      mockGetEventStats.mockResolvedValue([]);
      mockClearEvents.mockRejectedValueOnce(new Error('Clear failed'));

      renderAnalytics();

      // Wait for events to load
      await waitFor(() => {
        expect(screen.getByText('Clear')).toBeInTheDocument();
      });

      // Click clear button
      await user.click(screen.getByText('Clear'));

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText('Clear failed')).toBeInTheDocument();
      });
    });

    it('formats duration in seconds for values >= 1000ms', async () => {
      const mockEvents = [
        {
          id: '1',
          eventName: 'db_long_operation',
          durationMs: 2500,
          success: true,
          timestamp: new Date('2025-01-01T12:00:00Z')
        }
      ];

      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetEventStats.mockResolvedValue([]);

      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByText('2.50s')).toBeInTheDocument();
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

  describe('column sorting', () => {
    const mockEvents: AnalyticsEvent[] = [
      {
        id: '1',
        eventName: 'db_setup',
        durationMs: 150,
        success: true,
        timestamp: new Date('2025-01-01T12:00:00Z')
      },
      {
        id: '2',
        eventName: 'db_unlock',
        durationMs: 50,
        success: false,
        timestamp: new Date('2025-01-01T14:00:00Z')
      },
      {
        id: '3',
        eventName: 'db_query',
        durationMs: 200,
        success: true,
        timestamp: new Date('2025-01-01T10:00:00Z')
      }
    ];

    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetEventStats.mockResolvedValue([]);
    });

    it('renders sort buttons for all columns', async () => {
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
        expect(screen.getByTestId('sort-durationMs')).toBeInTheDocument();
        expect(screen.getByTestId('sort-success')).toBeInTheDocument();
        expect(screen.getByTestId('sort-timestamp')).toBeInTheDocument();
      });
    });

    it('sorts by event name ascending then descending', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Click to sort ascending
      await user.click(screen.getByTestId('sort-eventName'));

      // Get all rows and check order (Query, Setup, Unlock alphabetically)
      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        // Skip header row
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('Query');
        expect(dataRows[1]).toHaveTextContent('Setup');
        expect(dataRows[2]).toHaveTextContent('Unlock');
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('Unlock');
        expect(dataRows[1]).toHaveTextContent('Setup');
        expect(dataRows[2]).toHaveTextContent('Query');
      });
    });

    it('sorts by duration ascending then descending', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-durationMs')).toBeInTheDocument();
      });

      // Click to sort ascending (50ms, 150ms, 200ms)
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('50ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('200ms');
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('200ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('50ms');
      });
    });

    it('clears sort on third click', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Click three times: asc -> desc -> none
      await user.click(screen.getByTestId('sort-eventName'));
      await user.click(screen.getByTestId('sort-eventName'));
      await user.click(screen.getByTestId('sort-eventName'));

      // Should be back to original order (based on fetch order)
      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('Setup');
        expect(dataRows[1]).toHaveTextContent('Unlock');
        expect(dataRows[2]).toHaveTextContent('Query');
      });
    });

    it('sorts by success status ascending then descending', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-success')).toBeInTheDocument();
      });

      // Click to sort ascending (failed first, then success)
      await user.click(screen.getByTestId('sort-success'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        // First row should be the failed one (id: 2, db_unlock)
        expect(dataRows[0]).toHaveTextContent('Failed');
        expect(dataRows[1]).toHaveTextContent('Success');
        expect(dataRows[2]).toHaveTextContent('Success');
      });

      // Click again to sort descending (success first)
      await user.click(screen.getByTestId('sort-success'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('Success');
        expect(dataRows[1]).toHaveTextContent('Success');
        expect(dataRows[2]).toHaveTextContent('Failed');
      });
    });

    it('sorts by timestamp ascending then descending', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-timestamp')).toBeInTheDocument();
      });

      // Click to sort ascending (oldest first: 10:00, 12:00, 14:00)
      await user.click(screen.getByTestId('sort-timestamp'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        // Oldest first: Query (10:00), Setup (12:00), Unlock (14:00)
        expect(dataRows[0]).toHaveTextContent('Query');
        expect(dataRows[1]).toHaveTextContent('Setup');
        expect(dataRows[2]).toHaveTextContent('Unlock');
      });

      // Click again to sort descending (newest first)
      await user.click(screen.getByTestId('sort-timestamp'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        // Newest first: Unlock (14:00), Setup (12:00), Query (10:00)
        expect(dataRows[0]).toHaveTextContent('Unlock');
        expect(dataRows[1]).toHaveTextContent('Setup');
        expect(dataRows[2]).toHaveTextContent('Query');
      });
    });

    it('switches sort column when clicking a different header', async () => {
      const user = userEvent.setup();
      renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Sort by eventName first
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        expect(dataRows[0]).toHaveTextContent('Query');
      });

      // Now click duration - should reset to ascending on new column
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        const dataRows = rows.slice(1);
        // Ascending by duration: 50ms, 150ms, 200ms
        expect(dataRows[0]).toHaveTextContent('50ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('200ms');
      });
    });
  });
});

describe('sortEvents', () => {
  const events: AnalyticsEvent[] = [
    {
      id: '1',
      eventName: 'db_setup',
      durationMs: 150,
      success: true,
      timestamp: new Date('2025-01-01T12:00:00Z')
    },
    {
      id: '2',
      eventName: 'db_unlock',
      durationMs: 50,
      success: false,
      timestamp: new Date('2025-01-01T14:00:00Z')
    },
    {
      id: '3',
      eventName: 'db_query',
      durationMs: 200,
      success: true,
      timestamp: new Date('2025-01-01T10:00:00Z')
    }
  ];

  it('returns original order when no sort is applied', () => {
    const sort: SortState = { column: null, direction: null };
    const result = sortEvents(events, sort);
    expect(result.map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('does not mutate the original array', () => {
    const sort: SortState = { column: 'eventName', direction: 'asc' };
    const original = [...events];
    sortEvents(events, sort);
    expect(events).toEqual(original);
  });

  describe('sorting by eventName', () => {
    it('sorts ascending', () => {
      const sort: SortState = { column: 'eventName', direction: 'asc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.eventName)).toEqual([
        'db_query',
        'db_setup',
        'db_unlock'
      ]);
    });

    it('sorts descending', () => {
      const sort: SortState = { column: 'eventName', direction: 'desc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.eventName)).toEqual([
        'db_unlock',
        'db_setup',
        'db_query'
      ]);
    });
  });

  describe('sorting by durationMs', () => {
    it('sorts ascending', () => {
      const sort: SortState = { column: 'durationMs', direction: 'asc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.durationMs)).toEqual([50, 150, 200]);
    });

    it('sorts descending', () => {
      const sort: SortState = { column: 'durationMs', direction: 'desc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.durationMs)).toEqual([200, 150, 50]);
    });
  });

  describe('sorting by success', () => {
    it('sorts ascending (failed first)', () => {
      const sort: SortState = { column: 'success', direction: 'asc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.success)).toEqual([false, true, true]);
    });

    it('sorts descending (success first)', () => {
      const sort: SortState = { column: 'success', direction: 'desc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.success)).toEqual([true, true, false]);
    });
  });

  describe('sorting by timestamp', () => {
    it('sorts ascending (oldest first)', () => {
      const sort: SortState = { column: 'timestamp', direction: 'asc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.id)).toEqual(['3', '1', '2']);
    });

    it('sorts descending (newest first)', () => {
      const sort: SortState = { column: 'timestamp', direction: 'desc' };
      const result = sortEvents(events, sort);
      expect(result.map((e) => e.id)).toEqual(['2', '1', '3']);
    });
  });
});
