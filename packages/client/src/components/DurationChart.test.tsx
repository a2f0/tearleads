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

  it('displays total events count', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
        timeFilter="day"
      />
    );

    // 3 events total (2 db_setup + 1 db_unlock)
    expect(screen.getByText('3 events')).toBeInTheDocument();
  });

  it('displays singular event count for one event', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_unlock'])}
        timeFilter="day"
      />
    );

    // Only 1 db_unlock event
    expect(screen.getByText('1 event')).toBeInTheDocument();
  });

  describe('legend formatting', () => {
    it('formats event names by removing db_ prefix and capitalizing', () => {
      render(
        <DurationChart
          events={mockEvents}
          selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
          timeFilter="day"
        />
      );

      // db_setup -> Setup, db_unlock -> Unlock
      expect(screen.getByText('Setup')).toBeInTheDocument();
      expect(screen.getByText('Unlock')).toBeInTheDocument();
    });

    it('handles underscores in event names', () => {
      const eventsWithUnderscores = [
        {
          id: '1',
          eventName: 'db_file_upload',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={eventsWithUnderscores}
          selectedEventTypes={new Set(['db_file_upload'])}
          timeFilter="day"
        />
      );

      // db_file_upload -> File Upload
      expect(screen.getByText('File Upload')).toBeInTheDocument();
    });
  });

  describe('color cycling', () => {
    it('cycles through colors for many event types', () => {
      const manyEventTypes = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        eventName: `event_type_${i}`,
        durationMs: 100 + i,
        success: true,
        timestamp: new Date('2024-01-15T10:00:00Z')
      }));

      const selectedTypes = new Set(manyEventTypes.map((e) => e.eventName));

      render(
        <DurationChart
          events={manyEventTypes}
          selectedEventTypes={selectedTypes}
          timeFilter="day"
        />
      );

      // Should render all 10 legend items
      const legendItems = screen.getAllByText(/Event Type \d/);
      expect(legendItems.length).toBe(10);
    });
  });

  describe('failed event handling', () => {
    it('renders events with success=false', () => {
      const failedEvents = [
        {
          id: '1',
          eventName: 'db_operation',
          durationMs: 150,
          success: false,
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={failedEvents}
          selectedEventTypes={new Set(['db_operation'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('Operation')).toBeInTheDocument();
      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });
  });

  describe('data grouping', () => {
    it('groups events by event type correctly', () => {
      const groupedEvents = [
        ...mockEvents,
        {
          id: '4',
          eventName: 'db_setup',
          durationMs: 175,
          success: true,
          timestamp: new Date('2024-01-15T10:15:00Z')
        }
      ];

      render(
        <DurationChart
          events={groupedEvents}
          selectedEventTypes={new Set(['db_setup', 'db_unlock'])}
          timeFilter="day"
        />
      );

      // Should still show only 2 legend items even with 4 events
      expect(screen.getByText('Setup')).toBeInTheDocument();
      expect(screen.getByText('Unlock')).toBeInTheDocument();
    });
  });
});
