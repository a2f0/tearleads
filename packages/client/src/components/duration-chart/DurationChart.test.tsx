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

    expect(screen.getByText('Database Setup')).toBeInTheDocument();
    expect(screen.getByText('Database Unlock')).toBeInTheDocument();
  });

  it('filters events based on selectedEventTypes', () => {
    render(
      <DurationChart
        events={mockEvents}
        selectedEventTypes={new Set(['db_setup'])}
        timeFilter="day"
      />
    );

    expect(screen.getByText('Database Setup')).toBeInTheDocument();
    expect(screen.queryByText('Database Unlock')).not.toBeInTheDocument();
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
      expect(screen.getByText('Database Setup')).toBeInTheDocument();
      expect(screen.getByText('Database Unlock')).toBeInTheDocument();
    });

    it('handles underscores in event names', () => {
      const eventsWithUnderscores = [
        {
          id: '1',
          eventName: 'db_session_restore',
          durationMs: 100,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={eventsWithUnderscores}
          selectedEventTypes={new Set(['db_session_restore'])}
          timeFilter="day"
        />
      );

      // db_session_restore -> Session Restore
      expect(screen.getByText('Session Restore')).toBeInTheDocument();
    });
  });

  describe('color cycling', () => {
    it('cycles through colors for many event types', () => {
      const eventSlugs = [
        'db_setup',
        'db_unlock',
        'db_session_restore',
        'db_password_change',
        'file_encrypt',
        'file_decrypt',
        'api_get_ping',
        'api_get_admin_redis_keys',
        'llm_model_load',
        'llm_prompt_text'
      ];
      const manyEventTypes = eventSlugs.map((eventName, i) => ({
        id: String(i),
        eventName,
        durationMs: 100 + i,
        success: true,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        detail: null
      }));

      const selectedTypes = new Set(manyEventTypes.map((e) => e.eventName));

      render(
        <DurationChart
          events={manyEventTypes}
          selectedEventTypes={selectedTypes}
          timeFilter="day"
        />
      );

      // Should render all 10 legend items (one per event type)
      expect(screen.getByText('Database Setup')).toBeInTheDocument();
      expect(screen.getByText('Database Unlock')).toBeInTheDocument();
      expect(screen.getByText('Session Restore')).toBeInTheDocument();
      expect(screen.getByText('Password Change')).toBeInTheDocument();
      expect(screen.getByText('File Encrypt')).toBeInTheDocument();
      expect(screen.getByText('File Decrypt')).toBeInTheDocument();
      expect(screen.getByText('API Ping')).toBeInTheDocument();
      expect(screen.getByText('API List Redis Keys')).toBeInTheDocument();
      expect(screen.getByText('LLM Model Load')).toBeInTheDocument();
      expect(screen.getByText('LLM Text Prompt')).toBeInTheDocument();
    });
  });

  describe('failed event handling', () => {
    it('renders events with success=false', () => {
      const failedEvents = [
        {
          id: '1',
          eventName: 'file_decrypt',
          durationMs: 150,
          success: false,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={failedEvents}
          selectedEventTypes={new Set(['file_decrypt'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('File Decrypt')).toBeInTheDocument();
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
          timestamp: new Date('2024-01-15T10:15:00Z'),
          detail: null
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
      expect(screen.getByText('Database Setup')).toBeInTheDocument();
      expect(screen.getByText('Database Unlock')).toBeInTheDocument();
    });
  });

  describe('renders with various duration ranges', () => {
    it('mounts with sub-second duration events', () => {
      const fastEvents = [
        {
          id: '1',
          eventName: 'api_get_ping',
          durationMs: 50,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={fastEvents}
          selectedEventTypes={new Set(['api_get_ping'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('API Ping')).toBeInTheDocument();
      expect(screen.getByText('Duration Over Time')).toBeInTheDocument();
    });

    it('mounts with multi-second duration events', () => {
      const slowEvents = [
        {
          id: '1',
          eventName: 'llm_model_load',
          durationMs: 2500,
          success: true,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          detail: null
        }
      ];

      render(
        <DurationChart
          events={slowEvents}
          selectedEventTypes={new Set(['llm_model_load'])}
          timeFilter="day"
        />
      );

      expect(screen.getByText('LLM Model Load')).toBeInTheDocument();
    });
  });

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
});
