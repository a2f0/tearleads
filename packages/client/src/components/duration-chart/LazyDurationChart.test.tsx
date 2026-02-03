import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./DurationChart', () => ({
  DurationChart: ({ events }: { events: unknown[] }) => (
    <div data-testid="duration-chart">{events.length} events</div>
  )
}));

import { LazyDurationChart } from './LazyDurationChart';

describe('LazyDurationChart', () => {
  it('renders the chart after lazy loading', async () => {
    const events = [
      {
        id: '1',
        eventName: 'test',
        durationMs: 100,
        success: true,
        timestamp: new Date(),
        detail: null
      }
    ];

    render(
      <LazyDurationChart
        events={events}
        selectedEventTypes={new Set(['test'])}
        timeFilter="hour"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    });

    expect(screen.getByText('1 events')).toBeInTheDocument();
  });

  it('renders with empty events', async () => {
    render(
      <LazyDurationChart
        events={[]}
        selectedEventTypes={new Set()}
        timeFilter="day"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    });

    expect(screen.getByText('0 events')).toBeInTheDocument();
  });
});
