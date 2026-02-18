import type { VirtualItem } from '@tanstack/react-virtual';
import { VirtualListStatus } from '@tearleads/ui';
import { CheckCircle, Clock, Loader2, XCircle } from 'lucide-react';
import type { RefObject } from 'react';
import {
  type AnalyticsEvent,
  getEventDisplayName,
  type SortColumn
} from '@/db/analytics';
import { AnalyticsDurationChart } from './AnalyticsDurationChart';
import { SortIcon, type SortState } from './SortIcon';
import type { TimeFilter } from './types';

interface AnalyticsEventsPanelProps {
  parentRef: RefObject<HTMLDivElement | null>;
  visibleEvents: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: TimeFilter;
  firstVisible: number | null;
  lastVisible: number | null;
  events: AnalyticsEvent[];
  totalCount: number | null;
  hasMore: boolean;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  loading: boolean;
  loadingMore: boolean;
  virtualItems: VirtualItem[];
  totalVirtualSize: number;
  measureElement: (element: HTMLDivElement | null) => void;
  formatDuration: (duration: number) => string;
  formatTime: (date: Date) => string;
}

export function AnalyticsEventsPanel({
  parentRef,
  visibleEvents,
  selectedEventTypes,
  timeFilter,
  firstVisible,
  lastVisible,
  events,
  totalCount,
  hasMore,
  sort,
  onSort,
  loading,
  loadingMore,
  virtualItems,
  totalVirtualSize,
  measureElement,
  formatDuration,
  formatTime
}: AnalyticsEventsPanelProps) {
  return (
    <div
      ref={parentRef}
      data-testid="analytics-events-scroll-container"
      className="flex min-h-0 flex-1 flex-col overflow-auto"
    >
      <div className="sticky top-0 z-10 bg-background pb-2">
        <AnalyticsDurationChart
          events={visibleEvents}
          selectedEventTypes={selectedEventTypes}
          timeFilter={timeFilter}
        />
        <div className="mt-4 flex flex-col gap-2">
          <VirtualListStatus
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            loadedCount={events.length}
            totalCount={totalCount}
            hasMore={hasMore}
            itemLabel="event"
          />
          {events.length > 0 && (
            <div
              data-testid="analytics-header"
              className="grid grid-cols-[1fr_80px_80px] gap-2 rounded-t-lg border-x border-t bg-muted/50 px-2 py-2 font-medium text-xs [border-color:var(--soft-border)] sm:grid-cols-[1fr_100px_100px_160px] sm:gap-4 sm:px-4 sm:py-3 sm:text-sm"
            >
              <button
                type="button"
                onClick={() => onSort('eventName')}
                className="inline-flex items-center gap-1 text-left hover:text-foreground"
                data-testid="sort-eventName"
              >
                Event
                <SortIcon column="eventName" sort={sort} />
              </button>
              <button
                type="button"
                onClick={() => onSort('durationMs')}
                className="inline-flex items-center gap-1 text-left hover:text-foreground"
                data-testid="sort-durationMs"
              >
                <span className="hidden sm:inline">Duration</span>
                <span className="sm:hidden">Dur</span>
                <SortIcon column="durationMs" sort={sort} />
              </button>
              <button
                type="button"
                onClick={() => onSort('success')}
                className="inline-flex items-center gap-1 text-left hover:text-foreground"
                data-testid="sort-success"
              >
                Status
                <SortIcon column="success" sort={sort} />
              </button>
              <button
                type="button"
                onClick={() => onSort('timestamp')}
                className="hidden items-center gap-1 text-left hover:text-foreground sm:inline-flex"
                data-testid="sort-timestamp"
              >
                Time
                <SortIcon column="timestamp" sort={sort} />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground [border-color:var(--soft-border)]">
          No events recorded yet. Events will appear here after database
          operations.
        </div>
      ) : (
        <div className="rounded-b-lg border-x border-b [border-color:var(--soft-border)]">
          <div
            className="relative w-full"
            style={{ height: `${totalVirtualSize}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const isLoaderRow = virtualItem.index >= events.length;

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    className="absolute top-0 left-0 flex w-full items-center justify-center border-b p-4 text-muted-foreground text-xs [border-color:var(--soft-border)] sm:text-sm"
                    style={{
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`
                    }}
                  >
                    {loadingMore && (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading more...
                      </>
                    )}
                  </div>
                );
              }

              const event = events[virtualItem.index];
              if (!event) return null;

              return (
                <div
                  key={event.id}
                  data-index={virtualItem.index}
                  data-testid="analytics-row"
                  ref={measureElement}
                  className="absolute top-0 left-0 w-full border-b text-xs [border-color:var(--soft-border)] last:border-0 sm:text-sm"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-2 py-2 sm:grid-cols-[1fr_100px_100px_160px] sm:gap-4 sm:px-4 sm:py-3">
                    <div className="truncate font-medium">
                      {getEventDisplayName(event.eventName)}
                    </div>
                    <div>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {formatDuration(event.durationMs)}
                      </span>
                    </div>
                    <div>
                      {event.success ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle
                            className="h-3 w-3 sm:h-4 sm:w-4"
                            aria-hidden="true"
                          />
                          <span className="sr-only sm:not-sr-only">
                            Success
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle
                            className="h-3 w-3 sm:h-4 sm:w-4"
                            aria-hidden="true"
                          />
                          <span className="sr-only sm:not-sr-only">Failed</span>
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
      )}
    </div>
  );
}
