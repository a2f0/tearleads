import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportTableAsCsv } from '@/components/sqlite/exportTableCsv';
import { getDatabase } from '@/db';
import {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEventStats,
  getEvents
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';
import { AnalyticsEventsPanel } from './AnalyticsEventsPanel';
import { AnalyticsFiltersSummaryPanel } from './AnalyticsFiltersSummaryPanel';
import { AnalyticsInlineUnlock } from './AnalyticsInlineUnlock';
import { AnalyticsPageHeader } from './AnalyticsPageHeader';
import type {
  AnalyticsEvent,
  EventStats,
  SortColumn,
  StatsSortColumn
} from './analyticsTypes';
import type { SortState } from './SortIcon';
import type { SummarySortState, TimeFilter } from './types';

interface AnalyticsProps {
  showBackLink?: boolean;
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ROW_HEIGHT_ESTIMATE = 44;
const PAGE_SIZE = 50;

const ANALYTICS_SORT_COLUMN_MAP: Record<SortColumn, string> = {
  eventName: 'event_name',
  durationMs: 'duration_ms',
  success: 'success',
  timestamp: 'timestamp'
};

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

export function Analytics({
  showBackLink = true,
  onExportCsvChange
}: AnalyticsProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
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
  // Pagination cascade prevention guards
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  // Use ref to prevent duplicate fetches during React strict mode or re-renders
  const fetchingRef = useRef(false);
  // Track initial load to distinguish from user-cleared selections
  const isInitialLoad = useRef(true);
  const parentRef = useRef<HTMLDivElement>(null);
  // Track offset for pagination
  const offsetRef = useRef(0);
  // Track total count for pagination (ref to avoid fetchData dependency)
  const totalCountRef = useRef<number | null>(null);

  const virtualizer = useVirtualizer({
    count: events.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Calculate visible range excluding loader row
  const visibleEventItems = virtualItems.filter(
    (item) => item.index < events.length
  );
  const firstVisible =
    visibleEventItems.length > 0 ? (visibleEventItems[0]?.index ?? null) : null;
  const lastVisible =
    visibleEventItems.length > 0
      ? (visibleEventItems[visibleEventItems.length - 1]?.index ?? null)
      : null;

  const fetchData = useCallback(
    async (reset = true) => {
      if (!isUnlocked || fetchingRef.current) return;

      fetchingRef.current = true;
      if (reset) {
        setLoading(true);
        // Keep stale data visible during refresh to prevent UI flicker
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const db = getDatabase();
        const startTime = getTimeRange(timeFilter);
        const currentOffset = reset ? 0 : offsetRef.current;

        if (reset) {
          // On reset, fetch everything in parallel
          const [eventsData, statsData, typesData, countData] =
            await Promise.all([
              getEvents(db, {
                startTime,
                limit: PAGE_SIZE,
                offset: currentOffset,
                sortColumn: sort.column ?? undefined,
                sortDirection: sort.direction ?? undefined
              }),
              getEventStats(db, {
                startTime,
                sortColumn: summarySort.column ?? undefined,
                sortDirection: summarySort.direction ?? undefined
              }),
              getDistinctEventTypes(db),
              getEventCount(db, { startTime })
            ]);

          setEvents(eventsData);
          setStats(statsData);
          setEventTypes(typesData);
          setTotalCount(countData);
          totalCountRef.current = countData;
          offsetRef.current = eventsData.length;
          setHasMore(eventsData.length < countData);

          // Auto-select all types on initial load only
          if (isInitialLoad.current && typesData.length > 0) {
            setSelectedEventTypes(new Set(typesData));
            isInitialLoad.current = false;
          } else {
            // On subsequent fetches, prune selection of any types that no longer exist
            setSelectedEventTypes((prev) => {
              const validTypes = new Set(typesData);
              const filtered = new Set(
                [...prev].filter((t) => validTypes.has(t))
              );

              // If user's selection became empty because types disappeared, reset to all.
              // Otherwise, respect user's empty selection (e.g. from "Clear All").
              if (
                prev.size > 0 &&
                filtered.size === 0 &&
                typesData.length > 0
              ) {
                return new Set(typesData);
              }
              return filtered;
            });
          }

          // Mark initial load complete after reset - use requestAnimationFrame
          // to ensure state updates have been applied
          requestAnimationFrame(() => setInitialLoadComplete(true));
          setHasScrolled(false);
        } else {
          // On load more, only fetch events
          const eventsData = await getEvents(db, {
            startTime,
            limit: PAGE_SIZE,
            offset: currentOffset,
            sortColumn: sort.column ?? undefined,
            sortDirection: sort.direction ?? undefined
          });

          setEvents((prev) => [...prev, ...eventsData]);
          offsetRef.current = currentOffset + eventsData.length;
          setHasMore(
            totalCountRef.current !== null &&
              currentOffset + eventsData.length < totalCountRef.current
          );
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        fetchingRef.current = false;
      }
    },
    [isUnlocked, timeFilter, sort, summarySort]
  );

  const handleClear = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();
      await clearEvents(db);
      setEvents([]);
      setStats([]);
      setEventTypes([]);
      setSelectedEventTypes(new Set());
      setHasMore(false);
      setTotalCount(0);
      totalCountRef.current = 0;
      offsetRef.current = 0;
    } catch (err) {
      console.error('Failed to clear analytics:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isUnlocked]);

  const exportCsv = useCallback(async () => {
    if (exportingCsv || !isUnlocked) return;

    setExportingCsv(true);
    setError(null);

    try {
      const sortColumn = sort.column
        ? ANALYTICS_SORT_COLUMN_MAP[sort.column]
        : null;
      await exportTableAsCsv({
        tableName: 'analytics_events',
        sortColumn,
        sortDirection: sort.direction
      });
    } catch (err) {
      console.error('Failed to export analytics as CSV:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingCsv(false);
    }
  }, [exportingCsv, isUnlocked, sort]);

  useEffect(() => {
    if (!onExportCsvChange) return;
    if (!isUnlocked) {
      onExportCsvChange(null, false);
      return;
    }

    onExportCsvChange(exportCsv, exportingCsv);
    return () => {
      onExportCsvChange(null, false);
    };
  }, [exportCsv, exportingCsv, isUnlocked, onExportCsvChange]);

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

  const handleSummarySort = useCallback((column: StatsSortColumn) => {
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

  const filteredStats = useMemo(
    () => stats.filter((stat) => selectedEventTypes.has(stat.eventName)),
    [stats, selectedEventTypes]
  );

  // Compute visible events for the DurationChart based on virtual scroll viewport
  const visibleEvents = useMemo(() => {
    if (firstVisible === null || lastVisible === null) return events;
    return events.slice(firstVisible, lastVisible + 1);
  }, [events, firstVisible, lastVisible]);

  // Fetch data when unlocked state or time filter changes
  useEffect(() => {
    if (isUnlocked) {
      void fetchData(true);
    }

    return () => {
      fetchingRef.current = false;
    };
  }, [isUnlocked, fetchData]);

  // Detect scroll to enable pagination (once: true auto-removes after first scroll)
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => setHasScrolled(true);
    scrollElement.addEventListener('scroll', handleScroll, {
      passive: true,
      once: true
    });
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  // Load more when scrolling near the end
  useEffect(() => {
    // Guard: wait for initial load and user scroll before loading more
    if (!initialLoadComplete || !hasScrolled) return;
    if (!hasMore || loadingMore || loading || virtualItems.length === 0) return;

    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= events.length - 5) {
      void fetchData(false);
    }
  }, [
    initialLoadComplete,
    hasScrolled,
    virtualItems,
    hasMore,
    loadingMore,
    loading,
    events.length,
    fetchData
  ]);

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

  const formatCount = (count: number) => {
    if (count == null || Number.isNaN(count)) return '—';
    return count.toString();
  };

  const formatSuccessRate = (rate: number) => {
    if (rate == null || Number.isNaN(rate)) return '—';
    return `${rate}%`;
  };

  const handleRefresh = useCallback(() => {
    void fetchData(true);
  }, [fetchData]);

  const handleMeasureElement = useCallback(
    (element: HTMLDivElement | null) => {
      virtualizer.measureElement(element);
    },
    [virtualizer]
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <AnalyticsPageHeader
        showBackLink={showBackLink}
        isUnlocked={isUnlocked}
        loading={loading}
        hasEvents={events.length > 0}
        onClear={() => {
          void handleClear();
        }}
        onRefresh={handleRefresh}
      />

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <AnalyticsInlineUnlock description="analytics" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
          data-testid="analytics-scroll-container"
        >
          <AnalyticsFiltersSummaryPanel
            timeFilter={timeFilter}
            onTimeFilterChange={setTimeFilter}
            eventTypes={eventTypes}
            selectedEventTypes={selectedEventTypes}
            onToggleEventType={toggleEventType}
            onSelectAllEventTypes={selectAllEventTypes}
            onClearAllEventTypes={clearAllEventTypes}
            filteredStats={filteredStats}
            summarySort={summarySort}
            onSummarySort={handleSummarySort}
            formatCount={formatCount}
            formatDuration={formatDuration}
            formatSuccessRate={formatSuccessRate}
          />

          <AnalyticsEventsPanel
            parentRef={parentRef}
            visibleEvents={visibleEvents}
            selectedEventTypes={selectedEventTypes}
            timeFilter={timeFilter}
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            events={events}
            totalCount={totalCount}
            hasMore={hasMore}
            sort={sort}
            onSort={handleSort}
            loading={loading}
            loadingMore={loadingMore}
            virtualItems={virtualItems}
            totalVirtualSize={virtualizer.getTotalSize()}
            measureElement={handleMeasureElement}
            formatDuration={formatDuration}
            formatTime={formatTime}
          />
        </div>
      )}
    </div>
  );
}
