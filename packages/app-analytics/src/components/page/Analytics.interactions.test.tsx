import {
  mockConsoleError,
  mockConsoleWarn
} from '@analytics/test/consoleMocks';
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

describe('Analytics - Interactions', () => {
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

  describe('error handling', () => {
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
  });

  describe('refresh', () => {
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
  });

  describe('clear events', () => {
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
  });
});
