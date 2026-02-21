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

describe('Analytics - Summary Table Sorting', () => {
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

  it('renders summary table with all columns', async () => {
    await renderAnalytics();

    await waitFor(() => {
      expect(screen.getByTestId('summary-sort-eventName')).toBeInTheDocument();
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
      expect(screen.getByTestId('summary-sort-eventName')).toBeInTheDocument();
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
});
