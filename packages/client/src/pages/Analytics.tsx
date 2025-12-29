import {
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import {
  type AnalyticsEvent,
  clearEvents,
  type EventStats,
  getEventStats,
  getEvents
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';

type TimeFilter = 'hour' | 'day' | 'week' | 'all';

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  week: 'Last Week',
  all: 'All Time'
};

const getSuccessRateColor = (rate: number) => {
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

export function Analytics() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('day');

  const fetchData = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const startTime = getTimeRange(timeFilter);

      const [eventsData, statsData] = await Promise.all([
        getEvents(db, { startTime, limit: 100 }),
        getEventStats(db, { startTime })
      ]);

      setEvents(eventsData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, timeFilter]);

  const handleClear = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();
      await clearEvents(db);
      setEvents([]);
      setStats([]);
    } catch (err) {
      console.error('Failed to clear analytics:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked) {
      fetchData();
    }
  }, [isUnlocked, fetchData]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (date: Date) => {
    return date.toLocaleString();
  };

  const formatEventName = (name: string) => {
    return name
      .replace('db_', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
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

          {/* Stats summary */}
          {stats.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-semibold text-lg">Summary</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {stats.map((stat) => (
                  <div
                    key={stat.eventName}
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
                        {stat.count}
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
                        {stat.successRate}%
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
                      <th className="px-4 py-3 text-left font-medium">Event</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Duration
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
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
