import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle,
  Clock,
  Trash2,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DurationChart } from '@/components/duration-chart';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import {
  type AnalyticsEvent,
  clearEvents,
  type EventStats,
  getDistinctEventTypes,
  getEventStats,
  getEvents,
  type SortColumn
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';
import { SortIcon, type SortState } from './SortIcon';

type SummarySortColumn = keyof EventStats;
interface SummarySortState {
  column: SummarySortColumn | null;
  direction: 'asc' | 'desc' | null;
}

function SummarySortIcon({
  column,
  sort
}: {
  column: SummarySortColumn;
  sort: SummarySortState;
}) {
  if (sort.column !== column) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }
  return sort.direction === 'asc' ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}

type TimeFilter = 'hour' | 'day' | 'week' | 'all';

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  week: 'Last Week',
  all: 'All Time'
};
const TIME_FILTERS: TimeFilter[] = ['hour', 'day', 'week', 'all'];

const getSuccessRateColor = (rate: number) => {
  if (rate == null || Number.isNaN(rate)) return 'text-muted-foreground';
  if (rate >= 90) return 'text-green-600';
  if (rate >= 70) return 'text-yellow-600';
  return 'text-red-600';
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ROW_HEIGHT_ESTIMATE = 44;

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
  const [sort, setSort] = useState<SortState>({
    column: null,
    direction: null
  });
  const [summarySort, setSummarySort] = useState<SummarySortState>({
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
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  const fetchData = useCallback(async () => {
    if (!isUnlocked || fetchingRef.current) return;

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const startTime = getTimeRange(timeFilter);

      const [eventsData, statsData, typesData] = await Promise.all([
        getEvents(db, {
          startTime,
          limit: 100,
          sortColumn: sort.column ?? undefined,
          sortDirection: sort.direction ?? undefined
        }),
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
  }, [isUnlocked, timeFilter, sort]);

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

  const handleSummarySort = useCallback((column: SummarySortColumn) => {
    setSummarySort((prev) => {
      if (prev.column !== column) {
        return { column, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return { column: null, direction: null };
    });
  }, []);

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

  const sortedStats = useMemo(() => {
    if (!summarySort.column || !summarySort.direction) {
      return filteredStats;
    }
    const sorted = [...filteredStats];
    const col = summarySort.column;
    const dir = summarySort.direction;
    sorted.sort((a, b) => {
      const aVal = a[col];
      const bVal = b[col];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return dir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      return dir === 'asc' ? aNum - bNum : bNum - aNum;
    });
    return sorted;
  }, [filteredStats, summarySort]);

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
      .replace(/\b\w+/g, (word) => {
        const acronyms = ['api', 'llm'];
        if (acronyms.includes(word.toLowerCase())) {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.substring(1);
      });
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
    <div className="flex h-full min-w-0 flex-col space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Analytics
        </h1>
        {isUnlocked && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleClear}
              disabled={loading || events.length === 0}
              aria-label="Clear events"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <RefreshButton onClick={fetchData} loading={loading} />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="analytics" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <>
          {/* Time filter */}
          <div className="flex flex-wrap gap-2">
            {TIME_FILTERS.map((filter) => (
              <Button
                key={filter}
                variant={timeFilter === filter ? 'default' : 'outline'}
                size="sm"
                className="text-xs sm:text-sm"
                onClick={() => setTimeFilter(filter)}
              >
                {TIME_FILTER_LABELS[filter]}
              </Button>
            ))}
          </div>

          {/* Event type picker */}
          {eventTypes.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-base sm:text-lg">
                  Event Types
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs sm:text-sm"
                    onClick={selectAllEventTypes}
                    disabled={selectedEventTypes.size === eventTypes.length}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs sm:text-sm"
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
                    className="text-xs sm:text-sm"
                    onClick={() => toggleEventType(eventType)}
                  >
                    {formatEventName(eventType)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Stats summary table */}
          {filteredStats.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-semibold text-base sm:text-lg">Summary</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-2 py-2 text-left sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('eventName')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-eventName"
                        >
                          Event
                          <SummarySortIcon
                            column="eventName"
                            sort={summarySort}
                          />
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('count')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-count"
                        >
                          Count
                          <SummarySortIcon column="count" sort={summarySort} />
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('avgDurationMs')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-avgDurationMs"
                        >
                          Avg
                          <SummarySortIcon
                            column="avgDurationMs"
                            sort={summarySort}
                          />
                        </button>
                      </th>
                      <th className="hidden px-2 py-2 text-left sm:table-cell sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('minDurationMs')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-minDurationMs"
                        >
                          Min
                          <SummarySortIcon
                            column="minDurationMs"
                            sort={summarySort}
                          />
                        </button>
                      </th>
                      <th className="hidden px-2 py-2 text-left sm:table-cell sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('maxDurationMs')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-maxDurationMs"
                        >
                          Max
                          <SummarySortIcon
                            column="maxDurationMs"
                            sort={summarySort}
                          />
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left sm:px-4">
                        <button
                          type="button"
                          onClick={() => handleSummarySort('successRate')}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          data-testid="summary-sort-successRate"
                        >
                          Success
                          <SummarySortIcon
                            column="successRate"
                            sort={summarySort}
                          />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.map((stat) => (
                      <tr
                        key={stat.eventName}
                        className="border-b last:border-0"
                        data-testid="summary-row"
                      >
                        <td className="truncate px-2 py-2 font-medium sm:px-4">
                          {formatEventName(stat.eventName)}
                        </td>
                        <td className="px-2 py-2 sm:px-4">
                          {formatCount(stat.count)}
                        </td>
                        <td className="px-2 py-2 sm:px-4">
                          {formatDuration(stat.avgDurationMs)}
                        </td>
                        <td className="hidden px-2 py-2 sm:table-cell sm:px-4">
                          {formatDuration(stat.minDurationMs)}
                        </td>
                        <td className="hidden px-2 py-2 sm:table-cell sm:px-4">
                          {formatDuration(stat.maxDurationMs)}
                        </td>
                        <td className="px-2 py-2 sm:px-4">
                          <span
                            className={getSuccessRateColor(stat.successRate)}
                          >
                            {formatSuccessRate(stat.successRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Duration chart */}
          <DurationChart
            events={events}
            selectedEventTypes={selectedEventTypes}
            timeFilter={timeFilter}
          />

          {/* Events table */}
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            <h2 className="font-semibold text-base sm:text-lg">
              Recent Events
            </h2>
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
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
                <div className="border-b bg-muted/50">
                  <div
                    data-testid="analytics-header"
                    className="grid grid-cols-[1fr_80px_80px] gap-2 px-2 py-2 font-medium text-xs sm:grid-cols-[1fr_100px_100px_160px] sm:gap-4 sm:px-4 sm:py-3 sm:text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => handleSort('eventName')}
                      className="inline-flex items-center gap-1 text-left hover:text-foreground"
                      data-testid="sort-eventName"
                    >
                      Event
                      <SortIcon column="eventName" sort={sort} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('durationMs')}
                      className="inline-flex items-center gap-1 text-left hover:text-foreground"
                      data-testid="sort-durationMs"
                    >
                      <span className="hidden sm:inline">Duration</span>
                      <span className="sm:hidden">Dur</span>
                      <SortIcon column="durationMs" sort={sort} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('success')}
                      className="inline-flex items-center gap-1 text-left hover:text-foreground"
                      data-testid="sort-success"
                    >
                      Status
                      <SortIcon column="success" sort={sort} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('timestamp')}
                      className="hidden items-center gap-1 text-left hover:text-foreground sm:inline-flex"
                      data-testid="sort-timestamp"
                    >
                      Time
                      <SortIcon column="timestamp" sort={sort} />
                    </button>
                  </div>
                </div>
                <div
                  ref={parentRef}
                  className="min-h-[200px] flex-1 overflow-auto"
                >
                  <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
                    {virtualItems.map((virtualItem) => {
                      const event = events[virtualItem.index];
                      if (!event) return null;

                      return (
                        <div
                          key={event.id}
                          data-index={virtualItem.index}
                          data-testid="analytics-row"
                          ref={virtualizer.measureElement}
                          className="absolute top-0 left-0 w-full border-b text-xs last:border-0 sm:text-sm"
                          style={{
                            transform: `translateY(${virtualItem.start}px)`
                          }}
                        >
                          <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-2 py-2 sm:grid-cols-[1fr_100px_100px_160px] sm:gap-4 sm:px-4 sm:py-3">
                            <div className="truncate font-medium">
                              {formatEventName(event.eventName)}
                            </div>
                            <div>
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                {formatDuration(event.durationMs)}
                              </span>
                            </div>
                            <div>
                              {event.success ? (
                                <span className="inline-flex items-center gap-1 text-green-600">
                                  <CheckCircle
                                    className="h-3 w-3 sm:h-4 sm:w-4"
                                    aria-hidden="true"
                                  />
                                  <span className="sr-only sm:not-sr-only">
                                    Success
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-600">
                                  <XCircle
                                    className="h-3 w-3 sm:h-4 sm:w-4"
                                    aria-hidden="true"
                                  />
                                  <span className="sr-only sm:not-sr-only">
                                    Failed
                                  </span>
                                </span>
                              )}
                            </div>
                            <div className="hidden text-muted-foreground sm:block">
                              {formatTime(event.timestamp)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
