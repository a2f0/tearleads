import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsDurationChart } from './AnalyticsDurationChart';

describe('AnalyticsDurationChart', () => {
  it('renders summary for selected events and top rows', () => {
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

    expect(
      screen.getByText(/Duration Summary \(Last 24h\): 4s/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Database Setup: 3s/)).toBeInTheDocument();
    expect(screen.getByText(/db_query: 1s/)).toBeInTheDocument();
  });

  it('renders only summary when no selected events match', () => {
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
      screen.getByText(/Duration Summary \(All Time\): 0s/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Database Setup:/)).not.toBeInTheDocument();
  });
});
