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

describe('Analytics - Column Sorting API Calls', () => {
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

  // Define individual events
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

    mockGetEvents.mockResolvedValue(mockEventsOriginal);
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
