import { ThemeProvider } from '@tearleads/ui';
import {
  act,
  render as rtlRender,
  screen,
  waitFor
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurationChart } from './DurationChart';

function TestWrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider defaultTheme="light">{children}</ThemeProvider>;
}

// Custom render function that wraps components with ThemeProvider
function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: TestWrapper });
}

// Track ResizeObserver callbacks for testing
let resizeObserverCallback: ResizeObserverCallback | null = null;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

// Mock ResizeObserver which is required by Recharts ResponsiveContainer
// and our useContainerReady hook
class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock;

// Mock getBoundingClientRect to simulate container dimensions
const mockGetBoundingClientRect = vi.fn();

beforeEach(() => {
  resizeObserverCallback = null;
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Default to valid dimensions
  mockGetBoundingClientRect.mockReturnValue({
    width: 400,
    height: 200,
    top: 0,
    left: 0,
    bottom: 200,
    right: 400,
    x: 0,
    y: 0,
    toJSON: () => ({})
  });
  Element.prototype.getBoundingClientRect = mockGetBoundingClientRect;
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

const mockEvents = [
  {
    id: '1',
    eventName: 'db_setup',
    durationMs: 150,
    success: true,
    timestamp: new Date('2024-01-15T10:00:00Z'),
    detail: null
  },
  {
    id: '2',
    eventName: 'db_unlock',
    durationMs: 50,
    success: true,
    timestamp: new Date('2024-01-15T10:05:00Z'),
    detail: null
  },
  {
    id: '3',
    eventName: 'db_setup',
    durationMs: 200,
    success: false,
    timestamp: new Date('2024-01-15T10:10:00Z'),
    detail: null
  }
];describe('DurationChart', () => {


  describe('renders with different time filters', () => {
    it('mounts with hour time filter', () => {
      const hourEvents = [
        {
          id: '1',
          eventName: 'db_setup',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T14:30:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={hourEvents}
          selectedEventTypes={new Set(['db_setup'])}
          timeFilter="hour"
        />
      );

      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with week time filter', () => {
      const weekEvents = [
        {
          id: '1',
          eventName: 'db_setup',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        },
        {
          id: '2',
          eventName: 'db_setup',
          durationMs: 150,
          success: true,
          timestamp: new Date('2024-01-18T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={weekEvents}
          selectedEventTypes={new Set(['db_setup'])}
          timeFilter="week"
        />
      );

      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with all time filter', () => {
      const allEvents = [
        {
          id: '1',
          eventName: 'db_setup',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-01T10:00:00Z'),
          detail: null
        },
        {
          id: '2',
          eventName: 'db_setup',
          durationMs: 150,
          success: true,
          timestamp: new Date('2024-02-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={allEvents}
          selectedEventTypes={new Set(['db_setup'])}
          timeFilter="all"
        />
      );

      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });
  });

  describe('event name formatting edge cases', () => {
    it('handles events without db_ prefix', () => {
      const noDbPrefixEvents = [
        {
          id: '1',
          eventName: 'file_encrypt',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={noDbPrefixEvents}
          selectedEventTypes={new Set(['file_encrypt'])}
          timeFilter="day"
        />
      );

      // file_encrypt -> File Encrypt
      expect(screen.getByText('File Encrypt')).toBeInTheDocument();
    });
  });

  describe('empty selection behavior', () => {
    it('shows empty state with events but no selection', () => {
      render(
        <DurationChart
          events={mockEvents}
          selectedEventTypes={new Set()}
          timeFilter="day"
        />
      );

      expect(screen.getByText(/No events to display/i)).toBeInTheDocument();
    });
  });

  describe('container dimension handling', () => {
    it('waits for valid container dimensions before rendering chart', async () => {
      // Start with zero dimensions to simulate initial mount before layout
      mockGetBoundingClientRect.mockReturnValue({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      });

      render(
        <DurationChart
          events={mockEvents}
          selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
          timeFilter="day"
        />
      );

      // Title and legend should be visible even before chart renders
      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
      expect(screen.getByText('3 events')).toBeInTheDocument();

      // Simulate container getting valid dimensions via ResizeObserver
      mockGetBoundingClientRect.mockReturnValue({
        width: 400,
        height: 200,
        top: 0,
        left: 0,
        bottom: 200,
        right: 400,
        x: 0,
        y: 0,
        toJSON: () => ({})
      });

      // Trigger ResizeObserver callback with valid dimensions (wrapped in act for state update)
      await act(async () => {
        if (resizeObserverCallback) {
          resizeObserverCallback(
            [
              {
                contentRect: { width: 400, height: 200 } as DOMRectReadOnly,
                target: document.createElement('div'),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: []
              }
            ],
            new ResizeObserverMock(resizeObserverCallback)
          );
        }
      });

      // After valid dimensions, chart content should render
      await waitFor(() => {
        expect(screen.getByText('Database Setup')).toBeInTheDocument();
      });
    });

    it('renders chart immediately when container has valid initial dimensions', () => {
      // Container already has valid dimensions (default mock)
      render(
        <DurationChart
          events={mockEvents}
          selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
          timeFilter="day"
        />
      );

      // Chart should render immediately
      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
      expect(screen.getByText('Database Setup')).toBeInTheDocument();
      expect(screen.getByText('Database Unlock')).toBeInTheDocument();
    });
  });
});
