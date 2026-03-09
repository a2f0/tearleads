import { mockConsoleWarn } from '@analytics/test/consoleMocks';
import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Analytics - Summary Table Sorting API Calls', () => {
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
    mockGetEventCount.mockResolvedValue(0);

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });

    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue(mockStatsOriginal);
    mockGetDistinctEventTypes.mockResolvedValue([
      'api_get_ping',
      'db_setup',
      'llm_prompt_text'
    ]);
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

  it('triggers sort for min and max duration columns', async () => {
    const user = userEvent.setup();
    await renderAnalytics();

    await waitFor(() => {
      expect(
        screen.getByTestId('summary-sort-minDurationMs')
      ).toBeInTheDocument();
    });

    // Click min duration sort
    await user.click(screen.getByTestId('summary-sort-minDurationMs'));

    await waitFor(() => {
      expect(mockGetEventStats).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sortColumn: 'minDurationMs',
          sortDirection: 'asc'
        })
      );
    });

    // Click max duration sort
    await user.click(screen.getByTestId('summary-sort-maxDurationMs'));

    await waitFor(() => {
      expect(mockGetEventStats).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sortColumn: 'maxDurationMs',
          sortDirection: 'asc'
        })
      );
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
