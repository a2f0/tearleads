import { mockConsoleWarn } from '@analytics/test/consoleMocks';
import { ThemeProvider } from '@tearleads/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTableAsCsv } from '@/components/sqlite/exportTableCsv';
import { Analytics } from './Analytics';

// Note: userEvent is used for the export handler test with sorting

declare global {
  interface SVGElement {
    getBBox(): DOMRect;
  }
}

// Track how many times getEvents is called to detect infinite loops
let getEventsCallCount = 0;
let getEventStatsCallCount = 0;

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

vi.mock('@/components/sqlite/exportTableCsv', () => ({
  exportTableAsCsv: vi.fn()
}));

function renderAnalyticsRaw(props: ComponentProps<typeof Analytics> = {}) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Analytics {...props} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

async function renderAnalytics(props: ComponentProps<typeof Analytics> = {}) {
  const result = renderAnalyticsRaw(props);
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
  return result;
}

describe('Analytics - Rendering', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    getEventsCallCount = 0;
    getEventStatsCallCount = 0;
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

    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue([]);
    mockClearEvents.mockResolvedValue(undefined);
    mockGetDistinctEventTypes.mockResolvedValue([]);
    mockGetEventCount.mockResolvedValue(0);
    vi.mocked(exportTableAsCsv).mockResolvedValue(undefined);

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
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

  describe('basic rendering', () => {
    it('renders the analytics title', async () => {
      await renderAnalytics();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });

    it('shows back link by default', async () => {
      await renderAnalytics();
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('hides back link when disabled', async () => {
      await renderAnalytics({ showBackLink: false });
      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });

    it('registers export handler when unlocked', async () => {
      const onExportCsvChange = vi.fn();
      await renderAnalytics({ onExportCsvChange });

      const handlerCall = onExportCsvChange.mock.calls.find(
        (call) => typeof call[0] === 'function'
      );
      expect(handlerCall).toBeTruthy();
      expect(onExportCsvChange).toHaveBeenCalledWith(
        expect.any(Function),
        false
      );
    });

    it('exports analytics table with mapped sort column', async () => {
      const user = userEvent.setup();
      const onExportCsvChange = vi.fn();
      mockGetEvents.mockResolvedValue([
        {
          id: 'export-event',
          eventName: 'db_setup',
          durationMs: 150,
          success: true,
          timestamp: new Date('2025-01-01T12:00:00Z')
        }
      ]);
      mockGetEventCount.mockResolvedValue(1);
      await renderAnalytics({ onExportCsvChange });

      await waitFor(() => {
        expect(screen.getByTestId('sort-durationMs')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('sort-durationMs'));

      const handlerCalls = onExportCsvChange.mock.calls.filter(
        (call) => typeof call[0] === 'function'
      );
      const handler = handlerCalls[handlerCalls.length - 1]?.[0];
      if (typeof handler !== 'function') {
        throw new Error('Export handler missing');
      }

      await act(async () => {
        await handler();
      });

      expect(exportTableAsCsv).toHaveBeenCalledWith({
        tableName: 'analytics_events',
        sortColumn: 'duration_ms',
        sortDirection: 'asc'
      });
    });
  });

  describe('data fetching', () => {
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
  });

  describe('success rate colors', () => {
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
        expect(successRateElement).toHaveClass('text-warning');
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
        expect(successRateElement).toHaveClass('text-destructive');
      });
    });
  });

  describe('duration formatting', () => {
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
});
