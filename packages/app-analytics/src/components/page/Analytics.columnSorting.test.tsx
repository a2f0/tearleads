import { mockConsoleWarn } from '@analytics/test/consoleMocks';
import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@/db/analytics';
import { Analytics } from './Analytics';

declare global {
  interface SVGElement {
    getBBox(): DOMRect;
  }
}

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
    getEvents: (...args: unknown[]) => mockGetEvents(...args),
    getEventStats: (...args: unknown[]) => mockGetEventStats(...args),
    clearEvents: (...args: unknown[]) => mockClearEvents(...args),
    getDistinctEventTypes: (...args: unknown[]) =>
      mockGetDistinctEventTypes(...args),
    getEventCount: (...args: unknown[]) => mockGetEventCount(...args)
  };
});

vi.mock('@/components/sqlite/exportTableCsv', () => ({
  exportTableAsCsv: vi.fn()
}));

async function renderAnalytics(props: ComponentProps<typeof Analytics> = {}) {
  const result = render(
    <MemoryRouter>
      <ThemeProvider>
        <Analytics {...props} />
      </ThemeProvider>
    </MemoryRouter>
  );
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
  return result;
}

describe('Analytics - Column Sorting', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalGetBBox = SVGElement.prototype.getBBox;
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth'
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  );
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth'
  );
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  );
  let warnSpy: ReturnType<typeof mockConsoleWarn> | null = null;

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
    vi.clearAllMocks();
    warnSpy = mockConsoleWarn();
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 400,
      height: 200,
      top: 0,
      left: 0,
      bottom: 200,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }));
    SVGElement.prototype.getBBox = vi.fn(() => new DOMRect(0, 0, 400, 200));
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 200
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 400
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 200
    });

    mockClearEvents.mockResolvedValue(undefined);
    mockGetDistinctEventTypes.mockResolvedValue([]);
    mockGetEventCount.mockResolvedValue(0);

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

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    SVGElement.prototype.getBBox = originalGetBBox;
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientWidth',
        originalClientWidth
      );
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalClientHeight
      );
    }
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetWidth',
        originalOffsetWidth
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight
      );
    }
    if (warnSpy) {
      const allowedWarnings = ['width(-1) and height(-1)'];
      const unexpectedWarnings = warnSpy.mock.calls.filter((call) => {
        const firstArg = call[0];
        const message =
          typeof firstArg === 'string'
            ? firstArg
            : firstArg instanceof Error
              ? firstArg.message
              : '';
        return !allowedWarnings.some((allowed) => message.includes(allowed));
      });
      expect(unexpectedWarnings).toEqual([]);
      warnSpy.mockRestore();
      warnSpy = null;
    }
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
});
