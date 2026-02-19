import { useCallback, useLayoutEffect, useState } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { AnalyticsEvent } from '@/db/analytics';
import { getEventDisplayName } from './eventDisplayName';
import type { TimeFilter } from './types';

interface AnalyticsDurationChartProps {
  events: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: TimeFilter;
}

interface ChartPoint {
  color: string;
  durationMs: number;
  eventName: string;
  success: boolean;
  timestamp: number;
}

interface ScatterDotProps {
  cx?: number;
  cy?: number;
  fill?: string;
}

const CHART_COLORS = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#db2777',
  '#0891b2',
  '#7c3aed'
];

function ScatterDot({ cx = 0, cy = 0, fill = '#808080' }: ScatterDotProps) {
  return <circle cx={cx} cy={cy} r={4} fill={fill} />;
}

function useContainerReady(): [(node: HTMLDivElement | null) => void, boolean] {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
    if (!node) {
      setIsReady(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return;

    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) {
      setIsReady(true);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: nextWidth, height: nextHeight } = entry.contentRect;
        if (nextWidth > 0 && nextHeight > 0) {
          setIsReady(true);
          observer.disconnect();
          break;
        }
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [container]);

  return [containerRef, isReady];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatXAxisTick(value: number, timeFilter: TimeFilter): string {
  const date = new Date(value);
  if (timeFilter === 'hour') {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (timeFilter === 'day') {
    return date.toLocaleTimeString([], {
      hour: 'numeric'
    });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function AnalyticsDurationChart({
  events,
  selectedEventTypes,
  timeFilter
}: AnalyticsDurationChartProps) {
  const [containerRef, isContainerReady] = useContainerReady();
  const filteredEvents = events.filter((event) =>
    selectedEventTypes.has(event.eventName)
  );
  const colorMap = new Map<string, string>();
  let colorIndex = 0;
  for (const event of filteredEvents) {
    if (!colorMap.has(event.eventName)) {
      colorMap.set(
        event.eventName,
        CHART_COLORS[colorIndex % CHART_COLORS.length] ?? '#808080'
      );
      colorIndex += 1;
    }
  }

  const chartData: ChartPoint[] = filteredEvents.map((event) => ({
    timestamp: event.timestamp.getTime(),
    durationMs: event.durationMs,
    eventName: event.eventName,
    success: event.success,
    color: colorMap.get(event.eventName) ?? '#808080'
  }));

  const dataByEventType = new Map<string, ChartPoint[]>();
  for (const point of chartData) {
    const existing = dataByEventType.get(point.eventName) ?? [];
    existing.push(point);
    dataByEventType.set(point.eventName, existing);
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground text-sm [border-color:var(--soft-border)] sm:h-56">
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
      <div
        ref={containerRef}
        className="h-48 w-full sm:h-56"
        data-testid="duration-chart"
      >
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
              <Tooltip
                formatter={(value, _name, item) => {
                  const numericValue =
                    typeof value === 'number' ? value : Number(value ?? 0);
                  const eventName = item?.payload?.eventName;
                  const displayEventName =
                    typeof eventName === 'string'
                      ? getEventDisplayName(eventName)
                      : 'Event';
                  return [formatDuration(numericValue), displayEventName];
                }}
                labelFormatter={(label) => {
                  const numericLabel =
                    typeof label === 'number' ? label : Number(label);
                  return Number.isFinite(numericLabel)
                    ? new Date(numericLabel).toLocaleString()
                    : '';
                }}
              />
              {Array.from(dataByEventType.entries()).map(
                ([eventType, data]) => (
                  <Scatter
                    key={eventType}
                    name={getEventDisplayName(eventType)}
                    data={data}
                    fill={colorMap.get(eventType) ?? '#808080'}
                    shape={<ScatterDot />}
                  />
                )
              )}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {Array.from(colorMap.entries()).map(([eventType, color]) => (
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
