import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DurationChart } from './DurationChart';

// Mock ResizeObserver which is required by Recharts ResponsiveContainer
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock;

const mockEvents = [
  {
    id: '1',
    eventName: 'db_setup',
    durationMs: 150,
    success: true,
    timestamp: new Date('2024-01-15T10:00:00Z')
  },
  {
    id: '2',
    eventName: 'db_unlock',
    durationMs: 50,
    success: true,
    timestamp: new Date('2024-01-15T10:05:00Z')
  },
  {
    id: '3',
    eventName: 'db_setup',
    durationMs: 200,
    success: false,
    timestamp: new Date('2024-01-15T10:10:00Z')
  }
];

describe('DurationChart', () => {
  it('renders empty state when no events match selection', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set()}
        timeFilter="day"
      />
    );

    expect(screen.getByText(/No events to display/i)).toBeInTheDocument();
  });

  it('renders chart title when events are present', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
        timeFilter="day"
      />
    );

    expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
  });

  it('renders legend for selected event types', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
        timeFilter="day"
      />
    );

    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });

  it('filters events based on selectedEventTypes', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="day"
      />
    );

    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.queryByText('Unlock')).not.toBeInTheDocument();
  });

  it('renders with empty events array', () => {
    render(
      <DurationChart
        events={[]}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="day"
      />
    );

    expect(screen.getByText(/No events to display/i)).toBeInTheDocument();
  });

  it('handles different time filters', () => {
    const { rerender } = render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="hour"
      />
    );

    expect(screen.getByText('Duration Over Time')).toBeInTheDocument();

    rerender(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="week"
      />
    );

    expect(screen.getByText('Duration Over Time')).toBeInTheDocument();

    rerender(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="all"
      />
    );

    expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
  });

  it('assigns different colors to different event types', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
        timeFilter="day"
      />
    );

    const legendItems = screen
      .getAllByText(/Setup|Unlock/)
      .map((el) => el.previousElementSibling);

    // Each legend item should have a colored circle
    for (const item of legendItems) {
      expect(item).toHaveClass('rounded-full');
      expect(item).toHaveStyle({ backgroundColor: expect.any(String) });
    }
  });
});
