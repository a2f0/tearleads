import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DurationChart } from '@/components/duration-chart';
import {
  formatDuration,
  formatEventName
} from '@/components/duration-chart/formatters';
import { getDatabase } from '@/db';
import {
  type AnalyticsEvent,
  type EventStats,
  getDistinctEventTypes,
  getEventStats,
  getEvents
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function AnalyticsTab() {
  const { isUnlocked } = useDatabaseContext();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(false);
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!isUnlocked || fetchingRef.current) return;

    fetchingRef.current = true;
    setLoading(true);

    try {
      const db = getDatabase();
      const startTime = new Date(Date.now() - ONE_HOUR_MS);

      const [eventsData, statsData, typesData] = await Promise.all([
        getEvents(db, { startTime, limit: 50 }),
        getEventStats(db, { startTime }),
        getDistinctEventTypes(db)
      ]);

      setEvents(eventsData);
      setStats(statsData);
      setSelectedEventTypes(new Set(typesData));
    } catch (err) {
      console.error('Failed to fetch HUD analytics:', err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked) {
      fetchData();
    }
  }, [isUnlocked, fetchData]);

  if (!isUnlocked) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        Database locked
      </div>
    );
  }

  if (loading && events.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          Last Hour
        </span>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {stats.length > 0 && (
        <div className="space-y-1">
          {stats.slice(0, 5).map((stat) => (
            <div
              key={stat.eventName}
              className="flex items-center justify-between text-xs"
            >
              <span className="truncate font-medium">
                {formatEventName(stat.eventName)}
              </span>
              <span className="text-muted-foreground">
                {stat.count}x / {formatDuration(stat.avgDurationMs)} avg
              </span>
            </div>
          ))}
          {stats.length > 5 && (
            <div className="text-muted-foreground text-xs">
              +{stats.length - 5} more event types
            </div>
          )}
        </div>
      )}

      {events.length > 0 ? (
        <div className="h-32">
          <DurationChart
            events={events}
            selectedEventTypes={selectedEventTypes}
            timeFilter="hour"
          />
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center rounded border text-muted-foreground text-xs">
          No events in the last hour
        </div>
      )}
    </div>
  );
}
