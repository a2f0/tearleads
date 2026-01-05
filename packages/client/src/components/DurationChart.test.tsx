import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomDot,
  DurationChart,
  formatDuration,
  formatEventName,
  formatXAxisTick
} from './DurationChart';

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

  // Note: Recharts' ResponsiveContainer doesn't render actual chart elements (axes,
  // tooltips, data points) in jsdom, so we can only verify the component mounts
  // correctly with different data/props. The internal formatting functions
  // (formatDuration, formatXAxisTick, CustomTooltip) are exercised during render
  // but their output cannot be asserted in unit tests - this would require
  // integration tests in a real browser environment.
  describe('renders with various duration ranges', () => {
    it('mounts with sub-second duration events', () => {
      const fastEvents = [
        {
          id: '1',
          eventName: 'db_fast',
          durationMs: 50,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={fastEvents}
          selectedEventTypes={new Set(['db_fast'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('Fast')).toBeInTheDocument();
      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with multi-second duration events', () => {
      const slowEvents = [
        {
          id: '1',
          eventName: 'db_slow',
          durationMs: 2500,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={slowEvents}
          selectedEventTypes={new Set(['db_slow'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('Slow')).toBeInTheDocument();
    });
  });

  describe('renders with different time filters', () => {
    it('mounts with hour time filter', () => {
      const hourEvents = [
        {
          id: '1',
          eventName: 'db_test',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T14:30:00Z')
        }
      ];

      render(
        <DurationChart
          events={hourEvents}
          selectedEventTypes={new Set(['db_test'])}
          timeFilter="hour"
        />
      );

      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with week time filter', () => {
      const weekEvents = [
        {
          id: '1',
          eventName: 'db_test',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: '2',
          eventName: 'db_test',
          durationMs: 150,
          success: true,
          timestamp: new Date('2024-01-18T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={weekEvents}
          selectedEventTypes={new Set(['db_test'])}
          timeFilter="week"
        />
      );

      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with all time filter', () => {
      const allEvents = [
        {
          id: '1',
          eventName: 'db_test',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: '2',
          eventName: 'db_test',
          durationMs: 150,
          success: true,
          timestamp: new Date('2024-02-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={allEvents}
          selectedEventTypes={new Set(['db_test'])}
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
          eventName: 'custom_event',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z')
        }
      ];

      render(
        <DurationChart
          events={noDbPrefixEvents}
          selectedEventTypes={new Set(['custom_event'])}
          timeFilter="day"
        />
      );

      // custom_event -> Custom Event
      expect(screen.getByText('Custom Event')).toBeInTheDocument();
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
});

describe('formatDuration', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(50)).toBe('50ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats durations at exactly 1 second', () => {
    expect(formatDuration(1000)).toBe('1.00s');
  });

  it('formats multi-second durations in seconds', () => {
    expect(formatDuration(2500)).toBe('2.50s');
    expect(formatDuration(12345)).toBe('12.35s');
  });
});

describe('formatXAxisTick', () => {
  // Use a fixed date for consistent testing
  const timestamp = new Date('2024-01-15T14:30:00Z').getTime();

  it.each(['hour', 'day'])('formats %s filter as time', (filter) => {
    const result = formatXAxisTick(timestamp, filter);
    // Should contain time format (e.g., 02:30 PM or 14:30)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it.each(['week', 'all'])('formats %s filter as date', (filter) => {
    const result = formatXAxisTick(timestamp, filter);
    // Should contain month and day (e.g., Jan 15)
    expect(result).toContain('Jan');
    expect(result).toMatch(/\d{1,2}/);
  });
});

describe('formatEventName', () => {
  it('removes db_ prefix', () => {
    expect(formatEventName('db_setup')).toBe('Setup');
  });

  it('replaces underscores with spaces and capitalizes', () => {
    expect(formatEventName('db_file_upload')).toBe('File Upload');
    expect(formatEventName('db_multi_word_event')).toBe('Multi Word Event');
  });

  it('handles names without db_ prefix', () => {
    expect(formatEventName('custom_event')).toBe('Custom Event');
  });

  it('handles single word names', () => {
    expect(formatEventName('db_query')).toBe('Query');
  });
});

describe('CustomDot', () => {
  it('returns null when cx is undefined', () => {
    const result = CustomDot({ cy: 100, fill: 'blue' });
    expect(result).toBeNull();
  });

  it('returns null when cy is undefined', () => {
    const result = CustomDot({ cx: 100, fill: 'blue' });
    expect(result).toBeNull();
  });

  it('renders a circle when cx and cy are defined', () => {
    const result = CustomDot({ cx: 100, cy: 50, fill: 'blue' });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('circle');
    expect(result?.props.cx).toBe(100);
    expect(result?.props.cy).toBe(50);
    expect(result?.props.fill).toBe('blue');
    expect(result?.props.r).toBe(3); // SCATTER_DOT_RADIUS
  });
});
