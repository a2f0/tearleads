import { Button } from '@tearleads/ui';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { EventStats, StatsSortColumn } from '@/db/analytics';
import { getEventDisplayName } from './eventDisplayName';
import type { SummarySortState, TimeFilter } from './types';

interface AnalyticsFiltersSummaryPanelProps {
  timeFilter: TimeFilter;
  onTimeFilterChange: (filter: TimeFilter) => void;
  eventTypes: string[];
  selectedEventTypes: Set<string>;
  onToggleEventType: (eventType: string) => void;
  onSelectAllEventTypes: () => void;
  onClearAllEventTypes: () => void;
  filteredStats: EventStats[];
  summarySort: SummarySortState;
  onSummarySort: (column: StatsSortColumn) => void;
  formatCount: (count: number) => string;
  formatDuration: (duration: number) => string;
  formatSuccessRate: (rate: number) => string;
}

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  week: 'Last Week',
  all: 'All Time'
};

const TIME_FILTERS: TimeFilter[] = ['hour', 'day', 'week', 'all'];

function getSummarySortIcon(column: StatsSortColumn, sort: SummarySortState) {
  if (sort.column !== column) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }

  return sort.direction === 'asc' ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}

function getSuccessRateColor(rate: number) {
  if (rate == null || Number.isNaN(rate)) return 'text-muted-foreground';
  if (rate >= 90) return 'text-success';
  if (rate >= 70) return 'text-warning';
  return 'text-destructive';
}

export function AnalyticsFiltersSummaryPanel({
  timeFilter,
  onTimeFilterChange,
  eventTypes,
  selectedEventTypes,
  onToggleEventType,
  onSelectAllEventTypes,
  onClearAllEventTypes,
  filteredStats,
  summarySort,
  onSummarySort,
  formatCount,
  formatDuration,
  formatSuccessRate
}: AnalyticsFiltersSummaryPanelProps) {
  return (
    <div className="max-h-[40%] shrink-0 space-y-4 overflow-auto">
      <div className="flex flex-wrap gap-2">
        {TIME_FILTERS.map((filter) => (
          <Button
            key={filter}
            variant={timeFilter === filter ? 'default' : 'outline'}
            size="sm"
            className="text-xs sm:text-sm"
            onClick={() => onTimeFilterChange(filter)}
          >
            {TIME_FILTER_LABELS[filter]}
          </Button>
        ))}
      </div>

      {eventTypes.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-base sm:text-lg">Event Types</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm"
                onClick={onSelectAllEventTypes}
                disabled={selectedEventTypes.size === eventTypes.length}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm"
                onClick={onClearAllEventTypes}
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
                onClick={() => onToggleEventType(eventType)}
              >
                {getEventDisplayName(eventType)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {filteredStats.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-base sm:text-lg">Summary</h2>
          <div className="overflow-x-auto rounded-lg border [border-color:var(--soft-border)]">
            <table className={`${WINDOW_TABLE_TYPOGRAPHY.table} sm:text-sm`}>
              <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                <tr>
                  <th
                    className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('eventName')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-eventName"
                    >
                      Event
                      {getSummarySortIcon('eventName', summarySort)}
                    </button>
                  </th>
                  <th
                    className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('count')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-count"
                    >
                      Count
                      {getSummarySortIcon('count', summarySort)}
                    </button>
                  </th>
                  <th
                    className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('avgDurationMs')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-avgDurationMs"
                    >
                      Avg
                      {getSummarySortIcon('avgDurationMs', summarySort)}
                    </button>
                  </th>
                  <th
                    className={`hidden ${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:table-cell sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('minDurationMs')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-minDurationMs"
                    >
                      Min
                      {getSummarySortIcon('minDurationMs', summarySort)}
                    </button>
                  </th>
                  <th
                    className={`hidden ${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:table-cell sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('maxDurationMs')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-maxDurationMs"
                    >
                      Max
                      {getSummarySortIcon('maxDurationMs', summarySort)}
                    </button>
                  </th>
                  <th
                    className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} sm:px-4 sm:py-2`}
                  >
                    <button
                      type="button"
                      onClick={() => onSummarySort('successRate')}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      data-testid="summary-sort-successRate"
                    >
                      Success
                      {getSummarySortIcon('successRate', summarySort)}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => (
                  <WindowTableRow
                    key={stat.eventName}
                    className="cursor-default last:border-b-0 hover:bg-transparent"
                    data-testid="summary-row"
                  >
                    <td
                      className={`truncate ${WINDOW_TABLE_TYPOGRAPHY.cell} font-medium sm:px-4 sm:py-2`}
                    >
                      {getEventDisplayName(stat.eventName)}
                    </td>
                    <td
                      className={`${WINDOW_TABLE_TYPOGRAPHY.cell} sm:px-4 sm:py-2`}
                    >
                      {formatCount(stat.count)}
                    </td>
                    <td
                      className={`${WINDOW_TABLE_TYPOGRAPHY.cell} sm:px-4 sm:py-2`}
                    >
                      {formatDuration(stat.avgDurationMs)}
                    </td>
                    <td
                      className={`hidden ${WINDOW_TABLE_TYPOGRAPHY.cell} sm:table-cell sm:px-4 sm:py-2`}
                    >
                      {formatDuration(stat.minDurationMs)}
                    </td>
                    <td
                      className={`hidden ${WINDOW_TABLE_TYPOGRAPHY.cell} sm:table-cell sm:px-4 sm:py-2`}
                    >
                      {formatDuration(stat.maxDurationMs)}
                    </td>
                    <td
                      className={`${WINDOW_TABLE_TYPOGRAPHY.cell} sm:px-4 sm:py-2`}
                    >
                      <span className={getSuccessRateColor(stat.successRate)}>
                        {formatSuccessRate(stat.successRate)}
                      </span>
                    </td>
                  </WindowTableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
