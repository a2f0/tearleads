import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { type AnalyticsEvent, getEventDisplayName } from '@/db/analytics';
import { CustomDot } from './CustomDot';
import { CustomTooltip } from './CustomTooltip';
import { EVENT_COLORS } from './constants';
import { formatDuration, formatXAxisTick } from './formatters';

/**
 * Hook to track whether a container element has valid dimensions (> 0).
 * This prevents Recharts warnings about -1 width/height on initial render
 * before the browser has laid out the container.
 */
function useContainerReady(
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check immediately in case container already has dimensions
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) {
      setIsReady(true);
      return; // Early exit if already ready - no need for ResizeObserver
    }

    // Fallback timer ensures chart renders even if ResizeObserver doesn't fire
    const fallbackTimeout = setTimeout(() => setIsReady(true), 50);

    // Use ResizeObserver to detect when dimensions become valid
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setIsReady(true);
          clearTimeout(fallbackTimeout);
          observer.disconnect();
          break;
        }
      }
    });

    observer.observe(container);

    return () => {
      clearTimeout(fallbackTimeout);
      observer.disconnect();
    };
  }, [containerRef]);

  return isReady;
}

interface DurationChartProps {
  events: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: 'hour' | 'day' | 'week' | 'all';
}

export function DurationChart({
  events,
  selectedEventTypes,
  timeFilter
}: DurationChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const isContainerReady = useContainerReady(chartContainerRef);

  const { chartData, eventTypeColors, dataByEventType } = useMemo(() => {
    const filteredEvents = events.filter((e) =>
      selectedEventTypes.has(e.eventName)
    );

    // Build color map for event types
    const uniqueTypes = [...new Set(filteredEvents.map((e) => e.eventName))];
    const colorMap = new Map<string, string>();
    uniqueTypes.forEach((type, index) => {
      colorMap.set(
        type,
        EVENT_COLORS[index % EVENT_COLORS.length] ?? '#2563eb'
      );
    });

    // Transform events to chart data
    const data = filteredEvents.map((event) => ({
      timestamp: event.timestamp.getTime(),
      durationMs: event.durationMs,
      eventName: event.eventName,
      success: event.success,
      color: colorMap.get(event.eventName)
    }));

    // Group data by event type for separate scatter series
    const groupedData = new Map<string, (typeof data)[number][]>();
    data.forEach((point) => {
      const existing = groupedData.get(point.eventName) ?? [];
      existing.push(point);
      groupedData.set(point.eventName, existing);
    });

    return {
      chartData: data,
      eventTypeColors: colorMap,
      dataByEventType: groupedData
    };
  }, [events, selectedEventTypes]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground text-sm sm:h-56">
        No events to display. Select event types above to see the chart.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-muted-foreground text-sm">
          Duration Over Time
        </h2>
        <span className="text-muted-foreground text-xs">
          {chartData.length} event{chartData.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div ref={chartContainerRef} className="h-48 w-full sm:h-56">
        {isContainerReady && (
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
          >
            <ScatterChart margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  formatXAxisTick(value, timeFilter)
                }
                tick={{ fontSize: 10 }}
                stroke="currentColor"
              />
              <YAxis
                dataKey="durationMs"
                type="number"
                tickFormatter={formatDuration}
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                width={45}
              />
              <Tooltip content={<CustomTooltip />} />
              {[...dataByEventType.entries()].map(([eventType, data]) => (
                <Scatter
                  key={eventType}
                  name={getEventDisplayName(eventType)}
                  data={data}
                  fill={eventTypeColors.get(eventType) ?? '#2563eb'}
                  shape={<CustomDot />}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {[...eventTypeColors.entries()].map(([eventType, color]) => (
          <div key={eventType} className="flex items-center gap-1">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-muted-foreground">
              {getEventDisplayName(eventType)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
