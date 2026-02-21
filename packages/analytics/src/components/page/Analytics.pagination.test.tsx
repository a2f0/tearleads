import { mockConsoleWarn } from '@analytics/test/consoleMocks';
import { ThemeProvider } from '@tearleads/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
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

describe('Analytics - Pagination and Stability', () => {
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

  describe('stability under re-renders', () => {
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

  describe('pagination cascade prevention', () => {
    it('does not trigger load-more without user scroll', async () => {
      // Create a large dataset that would trigger load-more if guards weren't in place
      const mockEvents = Array.from({ length: 50 }, (_, i) => ({
        id: `${i + 1}`,
        eventName: 'db_setup',
        durationMs: 100 + i,
        success: true,
        timestamp: new Date('2025-01-01T12:00:00Z')
      }));

      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetEventStats.mockResolvedValue([]);
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);
      // Return total count greater than page size to indicate more data available
      mockGetEventCount.mockResolvedValue(200);

      await renderAnalytics();

      // Wait for initial load
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Wait a bit to ensure no additional load-more requests happen
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Should still only have 1 fetch - no load-more without scroll
      expect(getEventsCallCount).toBe(1);
    });

    it('resets scroll state on refresh', async () => {
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
      mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);
      mockGetEventCount.mockResolvedValue(1);

      await renderAnalytics();

      // Wait for initial load
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1);
      });

      // Click refresh button
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      // Should fetch again (reset=true)
      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2);
      });

      // After refresh, scroll state should be reset, so load-more shouldn't trigger
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Still only 2 fetches (initial + refresh), no load-more cascade
      expect(getEventsCallCount).toBe(2);
    });
  });
});
