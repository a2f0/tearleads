import { ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@/db/analytics';
import { mockConsoleError } from '@/test/console-mocks';
import { Analytics } from './Analytics';

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 44,
        size: 44,
        key: i
      })),
    getTotalSize: () => count * 44,
    measureElement: vi.fn()
  }))
}));

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
const mockGetDistinctEventTypes = vi.fn();
const mockGetEventCount = vi.fn();

vi.mock('@/db/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/analytics')>();
  return {
    ...actual,
    getEvents: (...args: unknown[]) => {
      getEventsCallCount++;
      return mockGetEvents(...args);
    },
    getEventStats: (...args: unknown[]) => {
      getEventStatsCallCount++;
      return mockGetEventStats(...args);
    },
    clearEvents: (...args: unknown[]) => mockClearEvents(...args),
    getDistinctEventTypes: (...args: unknown[]) =>
      mockGetDistinctEventTypes(...args),
    getEventCount: (...args: unknown[]) => mockGetEventCount(...args)
  };
});

function renderAnalyticsRaw() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Analytics />
      </ThemeProvider>
    </MemoryRouter>
  );
}

async function renderAnalytics() {
  const result = renderAnalyticsRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
  return result;
}

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventsCallCount = 0;
    getEventStatsCallCount = 0;

    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue([]);
    mockClearEvents.mockResolvedValue(undefined);
    mockGetDistinctEventTypes.mockResolvedValue([]);
    mockGetEventCount.mockResolvedValue(0);
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
    });

    it('shows loading message', () => {
      renderAnalyticsRaw();
      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not fetch analytics data', () => {
      renderAnalyticsRaw();
      expect(mockGetEvents).not.toHaveBeenCalled();
      expect(mockGetEventStats).not.toHaveBeenCalled();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });
    });

    it('shows inline unlock component', () => {
      renderAnalyticsRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view analytics./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderAnalyticsRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderAnalyticsRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('does not fetch analytics data', () => {
      renderAnalyticsRaw();
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
      await renderAnalytics();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });

    it('fetches analytics data on mount', async () => {
      await renderAnalytics();

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
        expect(mockGetEventStats).toHaveBeenCalledTimes(1);
      });
    });

    it('does not cause infinite re-fetches', async () => {
      await renderAnalytics();

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

      await renderAnalytics();

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
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

      await renderAnalytics();

      await waitFor(() => {
        // Event name appears in both summary and table, so use getAllByText
        const setupElements = screen.getAllByText('Database Setup');
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
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

      await renderAnalytics();

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
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

      await renderAnalytics();

      await waitFor(() => {
        const successRateElement = screen.getByText('50%');
        expect(successRateElement).toHaveClass('text-red-600');
      });
    });

    it('renders time filter buttons', async () => {
      await renderAnalytics();

      expect(screen.getByText('Last Hour')).toBeInTheDocument();
      expect(screen.getByText('Last 24h')).toBeInTheDocument();
      expect(screen.getByText('Last Week')).toBeInTheDocument();
      expect(screen.getByText('All Time')).toBeInTheDocument();
    });

    it('refetches data when time filter changes', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

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
      await renderAnalytics();

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
      await renderAnalytics();

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
      const consoleSpy = mockConsoleError();
      mockGetEvents.mockRejectedValueOnce(new Error('Fetch failed'));

      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByText('Fetch failed')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch analytics:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('refetches data when refresh button is clicked', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click refresh button (icon-only with aria-label)
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

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
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

      await renderAnalytics();

      // Wait for events to load
      await waitFor(() => {
        const setupElements = screen.getAllByText('Database Setup');
        expect(setupElements.length).toBeGreaterThan(0);
      });

      // Click clear button (icon-only with aria-label)
      await user.click(screen.getByRole('button', { name: 'Clear events' }));

      await waitFor(() => {
        expect(mockClearEvents).toHaveBeenCalledTimes(1);
      });
    });

    it('displays error when clear fails', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();

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

      await renderAnalytics();

      // Wait for events to load
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Clear events' })
        ).toBeInTheDocument();
      });

      // Click clear button (icon-only with aria-label)
      await user.click(screen.getByRole('button', { name: 'Clear events' }));

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText('Clear failed')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to clear analytics:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
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

      await renderAnalytics();

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
    // Define individual events to avoid non-null assertions
    const mockEventSetup: AnalyticsEvent = {
      id: '1',
      eventName: 'db_setup',
      durationMs: 150,
      success: true,
      timestamp: new Date('2025-01-01T12:00:00Z'),
      detail: null
    };
    const mockEventUnlock: AnalyticsEvent = {
      id: '2',
      eventName: 'db_unlock',
      durationMs: 50,
      success: false,
      timestamp: new Date('2025-01-01T14:00:00Z'),
      detail: null
    };
    const mockEventPasswordChange: AnalyticsEvent = {
      id: '3',
      eventName: 'db_password_change',
      durationMs: 200,
      success: true,
      timestamp: new Date('2025-01-01T10:00:00Z'),
      detail: null
    };

    const mockEventsOriginal: AnalyticsEvent[] = [
      mockEventSetup,
      mockEventUnlock,
      mockEventPasswordChange
    ];

    // Events sorted by eventName ascending (alphabetically: password_change, setup, unlock)
    const mockEventsSortedByNameAsc: AnalyticsEvent[] = [
      mockEventPasswordChange,
      mockEventSetup,
      mockEventUnlock
    ];

    // Events sorted by eventName descending
    const mockEventsSortedByNameDesc: AnalyticsEvent[] = [
      mockEventUnlock,
      mockEventSetup,
      mockEventPasswordChange
    ];

    // Events sorted by durationMs ascending (50, 150, 200)
    const mockEventsSortedByDurationAsc: AnalyticsEvent[] = [
      mockEventUnlock, // 50ms
      mockEventSetup, // 150ms
      mockEventPasswordChange // 200ms
    ];

    // Events sorted by durationMs descending (200, 150, 50)
    const mockEventsSortedByDurationDesc: AnalyticsEvent[] = [
      mockEventPasswordChange, // 200ms
      mockEventSetup, // 150ms
      mockEventUnlock // 50ms
    ];

    // Events sorted by success ascending (failed first: unlock, then setup, password_change)
    const mockEventsSortedBySuccessAsc: AnalyticsEvent[] = [
      mockEventUnlock, // failed
      mockEventSetup, // success
      mockEventPasswordChange // success
    ];

    // Events sorted by success descending (success first)
    const mockEventsSortedBySuccessDesc: AnalyticsEvent[] = [
      mockEventSetup, // success
      mockEventPasswordChange, // success
      mockEventUnlock // failed
    ];

    // Events sorted by timestamp ascending (oldest first: password_change at 10:00)
    const mockEventsSortedByTimestampAsc: AnalyticsEvent[] = [
      mockEventPasswordChange, // 10:00
      mockEventSetup, // 12:00
      mockEventUnlock // 14:00
    ];

    // Events sorted by timestamp descending (newest first: unlock at 14:00)
    const mockEventsSortedByTimestampDesc: AnalyticsEvent[] = [
      mockEventUnlock, // 14:00
      mockEventSetup, // 12:00
      mockEventPasswordChange // 10:00
    ];

    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      // Return original order by default, then return sorted based on parameters
      mockGetEvents.mockImplementation((_db, options) => {
        const sortedMocks: Record<string, Record<string, AnalyticsEvent[]>> = {
          eventName: {
            asc: mockEventsSortedByNameAsc,
            desc: mockEventsSortedByNameDesc
          },
          durationMs: {
            asc: mockEventsSortedByDurationAsc,
            desc: mockEventsSortedByDurationDesc
          },
          success: {
            asc: mockEventsSortedBySuccessAsc,
            desc: mockEventsSortedBySuccessDesc
          },
          timestamp: {
            asc: mockEventsSortedByTimestampAsc,
            desc: mockEventsSortedByTimestampDesc
          }
        };

        const { sortColumn, sortDirection } = options ?? {};
        if (
          sortColumn &&
          sortDirection &&
          sortedMocks[sortColumn]?.[sortDirection]
        ) {
          return Promise.resolve(sortedMocks[sortColumn][sortDirection]);
        }

        return Promise.resolve(mockEventsOriginal);
      });
      mockGetEventStats.mockResolvedValue([]);
    });

    it('renders sort buttons for all columns', async () => {
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
        expect(screen.getByTestId('sort-durationMs')).toBeInTheDocument();
        expect(screen.getByTestId('sort-success')).toBeInTheDocument();
        expect(screen.getByTestId('sort-timestamp')).toBeInTheDocument();
      });
    });

    it('sorts by event name ascending then descending', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Click to sort ascending
      await user.click(screen.getByTestId('sort-eventName'));

      // Get all rows and check order (Password Change, Setup, Unlock alphabetically)
      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('Password Change');
        expect(dataRows[1]).toHaveTextContent('Database Setup');
        expect(dataRows[2]).toHaveTextContent('Database Unlock');
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('Database Unlock');
        expect(dataRows[1]).toHaveTextContent('Database Setup');
        expect(dataRows[2]).toHaveTextContent('Password Change');
      });
    });

    it('sorts by duration ascending then descending', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-durationMs')).toBeInTheDocument();
      });

      // Click to sort ascending (50ms, 150ms, 200ms)
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('50ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('200ms');
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('200ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('50ms');
      });
    });

    it('clears sort on third click', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Click three times: asc -> desc -> none
      await user.click(screen.getByTestId('sort-eventName'));
      await user.click(screen.getByTestId('sort-eventName'));
      await user.click(screen.getByTestId('sort-eventName'));

      // Should be back to original order (based on fetch order)
      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('Database Setup');
        expect(dataRows[1]).toHaveTextContent('Database Unlock');
        expect(dataRows[2]).toHaveTextContent('Password Change');
      });
    });

    it('sorts by success status ascending then descending', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-success')).toBeInTheDocument();
      });

      // Click to sort ascending (failed first, then success)
      await user.click(screen.getByTestId('sort-success'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        // First row should be the failed one (id: 2, db_unlock)
        expect(dataRows[0]).toHaveTextContent('Failed');
        expect(dataRows[1]).toHaveTextContent('Success');
        expect(dataRows[2]).toHaveTextContent('Success');
      });

      // Click again to sort descending (success first)
      await user.click(screen.getByTestId('sort-success'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('Success');
        expect(dataRows[1]).toHaveTextContent('Success');
        expect(dataRows[2]).toHaveTextContent('Failed');
      });
    });

    it('sorts by timestamp ascending then descending', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-timestamp')).toBeInTheDocument();
      });

      // Click to sort ascending (oldest first: 10:00, 12:00, 14:00)
      await user.click(screen.getByTestId('sort-timestamp'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        // Oldest first: Password Change (10:00), Setup (12:00), Unlock (14:00)
        expect(dataRows[0]).toHaveTextContent('Password Change');
        expect(dataRows[1]).toHaveTextContent('Database Setup');
        expect(dataRows[2]).toHaveTextContent('Database Unlock');
      });

      // Click again to sort descending (newest first)
      await user.click(screen.getByTestId('sort-timestamp'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        // Newest first: Unlock (14:00), Setup (12:00), Password Change (10:00)
        expect(dataRows[0]).toHaveTextContent('Database Unlock');
        expect(dataRows[1]).toHaveTextContent('Database Setup');
        expect(dataRows[2]).toHaveTextContent('Password Change');
      });
    });

    it('switches sort column when clicking a different header', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('sort-eventName')).toBeInTheDocument();
      });

      // Sort by eventName first
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        expect(dataRows[0]).toHaveTextContent('Password Change');
      });

      // Now click duration - should reset to ascending on new column
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        const dataRows = screen.getAllByTestId('analytics-row');
        // Ascending by duration: 50ms, 150ms, 200ms
        expect(dataRows[0]).toHaveTextContent('50ms');
        expect(dataRows[1]).toHaveTextContent('150ms');
        expect(dataRows[2]).toHaveTextContent('200ms');
      });
    });

    it('calls getEvents with sort parameters when sorting', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Initial call should have no sort parameters
      expect(mockGetEvents).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          sortColumn: undefined,
          sortDirection: undefined
        })
      );

      // Click to sort by eventName ascending
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'eventName',
            sortDirection: 'asc'
          })
        );
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'eventName',
            sortDirection: 'desc'
          })
        );
      });

      // Click again to clear sort
      await user.click(screen.getByTestId('sort-eventName'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: undefined,
            sortDirection: undefined
          })
        );
      });
    });

    it('calls getEvents with sort parameters for each column type', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Test durationMs column
      await user.click(screen.getByTestId('sort-durationMs'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'durationMs',
            sortDirection: 'asc'
          })
        );
      });

      // Test success column
      await user.click(screen.getByTestId('sort-success'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'success',
            sortDirection: 'asc'
          })
        );
      });

      // Test timestamp column
      await user.click(screen.getByTestId('sort-timestamp'));

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'timestamp',
            sortDirection: 'asc'
          })
        );
      });
    });
  });

  describe('summary table sorting', () => {
    // Original order
    const mockStatsOriginal = [
      {
        eventName: 'api_get_ping',
        count: 10,
        avgDurationMs: 100,
        minDurationMs: 50,
        maxDurationMs: 200,
        successRate: 90
      },
      {
        eventName: 'db_setup',
        count: 5,
        avgDurationMs: 300,
        minDurationMs: 200,
        maxDurationMs: 400,
        successRate: 100
      },
      {
        eventName: 'llm_prompt_text',
        count: 20,
        avgDurationMs: 500,
        minDurationMs: 100,
        maxDurationMs: 1000,
        successRate: 75
      }
    ];

    // Sorted by count ascending (5, 10, 20)
    const mockStatsSortedByCountAsc = [
      mockStatsOriginal[1], // db_setup: 5
      mockStatsOriginal[0], // api_get_ping: 10
      mockStatsOriginal[2] // llm_prompt_text: 20
    ];

    // Sorted by count descending (20, 10, 5)
    const mockStatsSortedByCountDesc = [
      mockStatsOriginal[2], // llm_prompt_text: 20
      mockStatsOriginal[0], // api_get_ping: 10
      mockStatsOriginal[1] // db_setup: 5
    ];

    // Sorted by eventName ascending (alphabetically: api_get_ping, db_setup, llm_prompt_text)
    const mockStatsSortedByEventNameAsc = [
      mockStatsOriginal[0], // api_get_ping
      mockStatsOriginal[1], // db_setup
      mockStatsOriginal[2] // llm_prompt_text
    ];

    // Sorted by successRate ascending (75, 90, 100)
    const mockStatsSortedBySuccessRateAsc = [
      mockStatsOriginal[2], // llm_prompt_text: 75%
      mockStatsOriginal[0], // api_get_ping: 90%
      mockStatsOriginal[1] // db_setup: 100%
    ];

    // Sorted by avgDurationMs ascending (100, 300, 500)
    const mockStatsSortedByAvgDurationAsc = [
      mockStatsOriginal[0], // api_get_ping: 100ms
      mockStatsOriginal[1], // db_setup: 300ms
      mockStatsOriginal[2] // llm_prompt_text: 500ms
    ];

    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockGetEvents.mockResolvedValue([]);
      // Return sorted stats based on parameters
      mockGetEventStats.mockImplementation((_db, options) => {
        const { sortColumn, sortDirection } = options ?? {};

        if (sortColumn === 'count') {
          return Promise.resolve(
            sortDirection === 'asc'
              ? mockStatsSortedByCountAsc
              : mockStatsSortedByCountDesc
          );
        }
        if (sortColumn === 'eventName' && sortDirection === 'asc') {
          return Promise.resolve(mockStatsSortedByEventNameAsc);
        }
        if (sortColumn === 'successRate' && sortDirection === 'asc') {
          return Promise.resolve(mockStatsSortedBySuccessRateAsc);
        }
        if (sortColumn === 'avgDurationMs' && sortDirection === 'asc') {
          return Promise.resolve(mockStatsSortedByAvgDurationAsc);
        }

        return Promise.resolve(mockStatsOriginal);
      });
      mockGetDistinctEventTypes.mockResolvedValue([
        'api_get_ping',
        'db_setup',
        'llm_prompt_text'
      ]);
    });

    it('renders summary table with all columns', async () => {
      await renderAnalytics();

      await waitFor(() => {
        expect(
          screen.getByTestId('summary-sort-eventName')
        ).toBeInTheDocument();
        expect(screen.getByTestId('summary-sort-count')).toBeInTheDocument();
        expect(
          screen.getByTestId('summary-sort-avgDurationMs')
        ).toBeInTheDocument();
        expect(
          screen.getByTestId('summary-sort-minDurationMs')
        ).toBeInTheDocument();
        expect(
          screen.getByTestId('summary-sort-maxDurationMs')
        ).toBeInTheDocument();
        expect(
          screen.getByTestId('summary-sort-successRate')
        ).toBeInTheDocument();
      });
    });

    it('sorts summary table by count ascending then descending', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('summary-sort-count')).toBeInTheDocument();
      });

      // Click to sort ascending (5, 10, 20)
      await user.click(screen.getByTestId('summary-sort-count'));

      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        expect(rows[0]).toHaveTextContent('5');
        expect(rows[1]).toHaveTextContent('10');
        expect(rows[2]).toHaveTextContent('20');
      });

      // Click to sort descending (20, 10, 5)
      await user.click(screen.getByTestId('summary-sort-count'));

      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        expect(rows[0]).toHaveTextContent('20');
        expect(rows[1]).toHaveTextContent('10');
        expect(rows[2]).toHaveTextContent('5');
      });
    });

    it('sorts summary table by event name alphabetically', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(
          screen.getByTestId('summary-sort-eventName')
        ).toBeInTheDocument();
      });

      // Click to sort ascending (sorted by raw event name, not formatted name)
      await user.click(screen.getByTestId('summary-sort-eventName'));

      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        // Sorted by raw event name alphabetically:
        // api_get_ping < db_setup < llm_prompt_text
        expect(rows[0]).toHaveTextContent('API Ping');
        expect(rows[1]).toHaveTextContent('Database Setup');
        expect(rows[2]).toHaveTextContent('LLM Text Prompt');
      });
    });

    it('sorts summary table by success rate', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(
          screen.getByTestId('summary-sort-successRate')
        ).toBeInTheDocument();
      });

      // Click to sort ascending (75%, 90%, 100%)
      await user.click(screen.getByTestId('summary-sort-successRate'));

      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        expect(rows[0]).toHaveTextContent('75%');
        expect(rows[1]).toHaveTextContent('90%');
        expect(rows[2]).toHaveTextContent('100%');
      });
    });

    it('clears summary sort on third click', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(screen.getByTestId('summary-sort-count')).toBeInTheDocument();
      });

      // Click three times: asc -> desc -> none
      await user.click(screen.getByTestId('summary-sort-count'));
      await user.click(screen.getByTestId('summary-sort-count'));
      await user.click(screen.getByTestId('summary-sort-count'));

      // Should be back to original order (api_get_ping, db_setup, llm_prompt_text)
      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        expect(rows[0]).toHaveTextContent('API Ping');
        expect(rows[1]).toHaveTextContent('Database Setup');
        expect(rows[2]).toHaveTextContent('LLM Text Prompt');
      });
    });

    it('sorts summary table by average duration', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(
          screen.getByTestId('summary-sort-avgDurationMs')
        ).toBeInTheDocument();
      });

      // Click to sort ascending (100ms, 300ms, 500ms)
      await user.click(screen.getByTestId('summary-sort-avgDurationMs'));

      await waitFor(() => {
        const rows = screen.getAllByTestId('summary-row');
        expect(rows[0]).toHaveTextContent('100ms');
        expect(rows[1]).toHaveTextContent('300ms');
        expect(rows[2]).toHaveTextContent('500ms');
      });
    });

    it('calls getEventStats with sort parameters when sorting', async () => {
      const user = userEvent.setup();
      await renderAnalytics();

      await waitFor(() => {
        expect(mockGetEventStats).toHaveBeenCalledTimes(1);
      });

      // Initial call should have no sort parameters
      expect(mockGetEventStats).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          sortColumn: undefined,
          sortDirection: undefined
        })
      );

      // Click to sort by count ascending
      await user.click(screen.getByTestId('summary-sort-count'));

      await waitFor(() => {
        expect(mockGetEventStats).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'count',
            sortDirection: 'asc'
          })
        );
      });

      // Click again to sort descending
      await user.click(screen.getByTestId('summary-sort-count'));

      await waitFor(() => {
        expect(mockGetEventStats).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: 'count',
            sortDirection: 'desc'
          })
        );
      });

      // Click again to clear sort
      await user.click(screen.getByTestId('summary-sort-count'));

      await waitFor(() => {
        expect(mockGetEventStats).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            sortColumn: undefined,
            sortDirection: undefined
          })
        );
      });
    });
  });

  describe('event name formatting', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
    });

    it('displays hand-curated API event names', async () => {
      const mockStats = [
        {
          eventName: 'api_get_ping',
          count: 1,
          avgDurationMs: 100,
          minDurationMs: 100,
          maxDurationMs: 100,
          successRate: 100
        }
      ];

      mockGetEvents.mockResolvedValue([]);
      mockGetEventStats.mockResolvedValue(mockStats);
      mockGetDistinctEventTypes.mockResolvedValue(['api_get_ping']);

      await renderAnalytics();

      await waitFor(() => {
        // Should show hand-curated display name "API Ping"
        // Text appears in both event type picker button and summary table
        const elements = screen.getAllByText('API Ping');
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('displays hand-curated LLM event names', async () => {
      const mockStats = [
        {
          eventName: 'llm_prompt_text',
          count: 1,
          avgDurationMs: 100,
          minDurationMs: 100,
          maxDurationMs: 100,
          successRate: 100
        }
      ];

      mockGetEvents.mockResolvedValue([]);
      mockGetEventStats.mockResolvedValue(mockStats);
      mockGetDistinctEventTypes.mockResolvedValue(['llm_prompt_text']);

      await renderAnalytics();

      await waitFor(() => {
        // Should show hand-curated display name "LLM Text Prompt"
        // Text appears in both event type picker button and summary table
        const elements = screen.getAllByText('LLM Text Prompt');
        expect(elements.length).toBeGreaterThan(0);
      });
    });
  });
});
