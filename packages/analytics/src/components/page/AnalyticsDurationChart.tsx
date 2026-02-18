import { type AnalyticsEvent, getEventDisplayName } from '@/db/analytics';
import type { TimeFilter } from './types';

interface AnalyticsDurationChartProps {
  events: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: TimeFilter;
}

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  week: 'Last Week',
  all: 'All Time'
};

export function AnalyticsDurationChart({
  events,
  selectedEventTypes,
  timeFilter
}: AnalyticsDurationChartProps) {
  const filteredEvents = events.filter((event) =>
    selectedEventTypes.has(event.eventName)
  );
  const totalDurationMs = filteredEvents.reduce(
    (total, event) => total + event.durationMs,
    0
  );
  const totalSeconds = Math.round(totalDurationMs / 1000);

  const topEvents = filteredEvents.reduce<Map<string, number>>((acc, event) => {
    const current = acc.get(event.eventName) ?? 0;
    acc.set(event.eventName, current + event.durationMs);
    return acc;
  }, new Map());

  const topEventRows = Array.from(topEvents.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div
      className="rounded-lg border bg-muted/20 px-3 py-2 text-xs [border-color:var(--soft-border)] sm:text-sm"
      data-testid="analytics-duration-summary"
    >
      <div className="font-medium">
        Duration Summary ({TIME_FILTER_LABELS[timeFilter]}): {totalSeconds}s
      </div>
      {topEventRows.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {topEventRows.map(([eventName, duration]) => (
            <span key={eventName}>
              {getEventDisplayName(eventName)}: {Math.round(duration / 1000)}s
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
