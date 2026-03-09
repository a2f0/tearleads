import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsDurationChart } from './AnalyticsDurationChart';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-responsive">{children}</div>
  ),
  ScatterChart: ({ children }: { children: ReactNode }) => (
    <svg>
      <title>Mock Scatter Chart</title>
      {children}
    </svg>
  ),
  Scatter: () => <circle cx="1" cy="1" r="1" />,
  CartesianGrid: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => (
    <span data-testid="x-axis">{tickFormatter?.(1735831800000)}</span>
  ),
  YAxis: ({ tickFormatter }: { tickFormatter?: (value: number) => string }) => (
    <span data-testid="y-axis">
      {tickFormatter?.(500)}|{tickFormatter?.(1500)}
    </span>
  ),
  Tooltip: ({
    formatter,
    labelFormatter
  }: {
    formatter?: (
      value: number,
      _name: string,
      item: { payload: { eventName: string } }
    ) => [string, string];
    labelFormatter?: (value: number) => string;
  }) => (
    <span data-testid="tooltip">
      {formatter?.(1500, '', { payload: { eventName: 'db_setup' } })?.join(':')}
      {labelFormatter?.(1735831800000)}
    </span>
  )
}));

describe('AnalyticsDurationChart', () => {
  it('renders chart heading and legend for selected events', () => {
    render(
      <ThemeProvider>
        <AnalyticsDurationChart
          events={[
            {
              id: '1',
              eventName: 'db_setup',
              durationMs: 2000,
              success: true,
              timestamp: new Date(),
              detail: null
            },
            {
              id: '2',
              eventName: 'db_setup',
              durationMs: 1000,
              success: true,
              timestamp: new Date(),
              detail: null
            },
            {
              id: '3',
              eventName: 'db_query',
              durationMs: 500,
              success: true,
              timestamp: new Date(),
              detail: null
            }
          ]}
          selectedEventTypes={new Set(['db_setup', 'db_query'])}
          timeFilter="day"
        />
      </ThemeProvider>
    );

    expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    expect(screen.getByText(/Database Setup/)).toBeInTheDocument();
    expect(screen.getByText(/Database Query/)).toBeInTheDocument();
  });

  it('renders empty state when no selected events match', () => {
    render(
      <ThemeProvider>
        <AnalyticsDurationChart
          events={[
            {
              id: '1',
              eventName: 'db_setup',
              durationMs: 2000,
              success: true,
              timestamp: new Date(),
              detail: null
            }
          ]}
          selectedEventTypes={new Set(['db_query'])}
          timeFilter="all"
        />
      </ThemeProvider>
    );

    expect(
      screen.getByText(
        /No events to display. Select event types above to see the chart./
      )
    ).toBeInTheDocument();
  });

  it('formats hour and week ticks without crashing', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        top: 0,
        right: 200,
        bottom: 200,
        left: 0,
        toJSON: () => ({})
      });

    const event = {
      id: '1',
      eventName: 'db_setup',
      durationMs: 1200,
      success: true,
      timestamp: new Date('2025-01-02T15:30:00Z'),
      detail: null
    };

    const { rerender } = render(
      <ThemeProvider>
        <AnalyticsDurationChart
          events={[event]}
          selectedEventTypes={new Set(['db_setup'])}
          timeFilter="hour"
        />
      </ThemeProvider>
    );

    expect(screen.getByTestId('x-axis')).toBeInTheDocument();
    expect(screen.getByTestId('y-axis')).toHaveTextContent('500ms|1.5s');
    expect(screen.getByTestId('tooltip')).toHaveTextContent(
      '1.5s:Database Setup'
    );

    rerender(
      <ThemeProvider>
        <AnalyticsDurationChart
          events={[event]}
          selectedEventTypes={new Set(['db_setup'])}
          timeFilter="week"
        />
      </ThemeProvider>
    );

    expect(screen.getByTestId('x-axis')).toBeInTheDocument();

    rectSpy.mockRestore();
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: originalResizeObserver
    });
  });
});
