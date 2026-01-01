import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import {
  type AnalyticsEvent,
  clearEvents,
  type EventStats,
  getDistinctEventTypes,
  getEventStats,
  getEvents
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';

type TimeFilter = 'hour' | 'day' | 'week' | 'all';

export type SortColumn = 'eventName' | 'durationMs' | 'success' | 'timestamp';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: SortColumn | null;
  direction: SortDirection | null;
}

/**
 * Sort analytics events by the specified column and direction.
 * Exported for testing.
 */
export function sortEvents(
  events: AnalyticsEvent[],
  sort: SortState
): AnalyticsEvent[] {
  if (!sort.column || !sort.direction) {
    return events;
  }

  const { column, direction } = sort;
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...events].sort((a, b) => {
    switch (column) {
      case 'eventName':
        return multiplier * a.eventName.localeCompare(b.eventName);
      case 'durationMs':
        return multiplier * (a.durationMs - b.durationMs);
      case 'success':
        // false (failed) comes before true (success) in ascending order
        return multiplier * (Number(a.success) - Number(b.success));
      case 'timestamp':
        return multiplier * (a.timestamp.getTime() - b.timestamp.getTime());
      default:
        return 0;
    }
  });
}

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  week: 'Last Week',
  all: 'All Time'
};

const getSuccessRateColor = (rate: number) => {
  if (rate == null || Number.isNaN(rate)) return 'text-muted-foreground';
  if (rate >= 90) return 'text-green-600';
  if (rate >= 70) return 'text-yellow-600';
  return 'text-red-600';
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

function getTimeRange(filter: TimeFilter): Date | undefined {
  const now = new Date();
  switch (filter) {
    case 'hour':
      return new Date(now.getTime() - ONE_HOUR_MS);
    case 'day':
      return new Date(now.getTime() - ONE_DAY_MS);
    case 'week':
      return new Date(now.getTime() - ONE_WEEK_MS);
    case 'all':
      return undefined;
  }
}

function SortIcon({ column, sort }: { column: SortColumn; sort: SortState }) {
  if (sort.column !== column) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }
  return sort.direction === 'asc' ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}

export function Analytics() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('day');
  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null
  });
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    new Set()
  );

  // Use ref to prevent duplicate fetches during React strict mode or re-renders
  const fetchingRef = useRef(false);
  // Track initial load to distinguish from user-cleared selections
  const isInitialLoad = useRef(true);

  const fetchData = useCallback(async () => {
    if (!isUnlocked || fetchingRef.current) return;

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const startTime = getTimeRange(timeFilter);

      const [eventsData, statsData, typesData] = await Promise.all([
        getEvents(db, { startTime, limit: 100 }),
        getEventStats(db, { startTime }),
        getDistinctEventTypes(db)
      ]);

      setEvents(eventsData);
      setStats(statsData);
      setEventTypes(typesData);

      // Auto-select all types on initial load only
      if (isInitialLoad.current && typesData.length > 0) {
        setSelectedEventTypes(new Set(typesData));
        isInitialLoad.current = false;
      } else {
        // On subsequent fetches, prune selection of any types that no longer exist
        setSelectedEventTypes((prev) => {
          const validTypes = new Set(typesData);
          const filtered = new Set([...prev].filter((t) => validTypes.has(t)));

          // If user's selection became empty because types disappeared, reset to all.
          // Otherwise, respect user's empty selection (e.g. from "Clear All").
          if (prev.size > 0 && filtered.size === 0 && typesData.length > 0) {
            return new Set(typesData);
          }
          return filtered;
        });
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [isUnlocked, timeFilter]);

  const handleClear = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();
      await clearEvents(db);
      setEvents([]);
      setStats([]);
      setEventTypes([]);
      setSelectedEventTypes(new Set());
    } catch (err) {
      console.error('Failed to clear analytics:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isUnlocked]);

  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (prev.column !== column) {
        return { column, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return { column: null, direction: null };
    });
  }, []);

  const sortedEvents = useMemo(() => sortEvents(events, sort), [events, sort]);

  const toggleEventType = useCallback((eventType: string) => {
    setSelectedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  }, []);

  const selectAllEventTypes = useCallback(() => {
    setSelectedEventTypes(new Set(eventTypes));
  }, [eventTypes]);

  const clearAllEventTypes = useCallback(() => {
    setSelectedEventTypes(new Set());
  }, []);

  const filteredStats = stats.filter((stat) =>
    selectedEventTypes.has(stat.eventName)
  );

  // Fetch data when unlocked state or time filter changes
  useEffect(() => {
    if (isUnlocked) {
      fetchData();
    }
  }, [isUnlocked, fetchData]);

  const formatDuration = (ms: number) => {
    if (ms == null || Number.isNaN(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (date: Date) => {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString();
  };

  const formatEventName = (name: string | undefined) => {
    if (!name) return '(Unknown)';
    return name
      .replace('db_', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatCount = (count: number) => {
    if (count == null || Number.isNaN(count)) return '—';
    return count.toString();
  };

  const formatSuccessRate = (rate: number) => {
    if (rate == null || Number.isNaN(rate)) return '—';
    return `${rate}%`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Analytics</h1>
        {isUnlocked && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={loading || events.length === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view
            analytics.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <>
          {/* Time filter */}
          <div className="flex gap-2">
            {(['hour', 'day', 'week', 'all'] as TimeFilter[]).map((filter) => (
              <Button
                key={filter}
                variant={timeFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeFilter(filter)}
              >
                {TIME_FILTER_LABELS[filter]}
              </Button>
            ))}
          </div>

          {/* Event type picker */}
          {eventTypes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">Event Types</h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllEventTypes}
                    disabled={selectedEventTypes.size === eventTypes.length}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllEventTypes}
                    disabled={selectedEventTypes.size === 0}
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {eventTypes.map((eventType) => (
                  <Button
                    key={eventType}
                    variant={
                      selectedEventTypes.has(eventType) ? 'default' : 'outline'
                    }
                    size="sm"
                    onClick={() => toggleEventType(eventType)}
                  >
                    {formatEventName(eventType)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Stats summary */}
          {filteredStats.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-semibold text-lg">Summary</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredStats.map((stat, index) => (
                  <div
                    key={`stat-${index}-${stat.eventName}`}
                    className="rounded-lg border bg-muted/50 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {formatEventName(stat.eventName)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Count:</span>{' '}
                        {formatCount(stat.count)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg:</span>{' '}
                        {formatDuration(stat.avgDurationMs)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Min:</span>{' '}
                        {formatDuration(stat.minDurationMs)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max:</span>{' '}
                        {formatDuration(stat.maxDurationMs)}
                      </div>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">
                        Success Rate:
                      </span>{' '}
                      <span className={getSuccessRateColor(stat.successRate)}>
                        {formatSuccessRate(stat.successRate)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Events table */}
          <div className="space-y-2">
            <h2 className="font-semibold text-lg">Recent Events</h2>
            {loading && events.length === 0 ? (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                Loading events...
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                No events recorded yet. Events will appear here after database
                operations.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort('eventName')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          data-testid="sort-eventName"
                        >
                          Event
                          <SortIcon column="eventName" sort={sort} />
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort('durationMs')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          data-testid="sort-durationMs"
                        >
                          Duration
                          <SortIcon column="durationMs" sort={sort} />
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort('success')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          data-testid="sort-success"
                        >
                          Status
                          <SortIcon column="success" sort={sort} />
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => handleSort('timestamp')}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          data-testid="sort-timestamp"
                        >
                          Time
                          <SortIcon column="timestamp" sort={sort} />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEvents.map((event) => (
                      <tr key={event.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {formatEventName(event.eventName)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {formatDuration(event.durationMs)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {event.success ? (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <XCircle className="h-4 w-4" />
                              Failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatTime(event.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
