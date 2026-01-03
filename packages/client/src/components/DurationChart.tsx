import { useMemo } from 'react';
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

interface DurationChartProps {
  events: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: 'hour' | 'day' | 'week' | 'all';
}

const EVENT_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#dc2626', // red
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#c026d3', // fuchsia
  '#65a30d' // lime
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatXAxisTick(timestamp: number, timeFilter: string): string {
  const date = new Date(timestamp);
  if (timeFilter === 'hour') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (timeFilter === 'day') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatEventName(name: string): string {
  return name
    .replace('db_', '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TooltipPayloadItem {
  payload: {
    eventName: string;
    timestamp: number;
    durationMs: number;
    success: boolean;
  };
}

function CustomTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  const firstPayload = payload?.[0];
  if (!active || !firstPayload) return null;

  const data = firstPayload.payload;
  return (
    <div className="rounded-lg border bg-background p-2 shadow-md">
      <p className="font-medium">{formatEventName(data.eventName)}</p>
      <p className="text-muted-foreground text-sm">
        Duration: {formatDuration(data.durationMs)}
      </p>
      <p className="text-muted-foreground text-sm">
        Time: {new Date(data.timestamp).toLocaleString()}
      </p>
      <p className="text-sm">
        Status:{' '}
        <span className={data.success ? 'text-green-600' : 'text-red-600'}>
          {data.success ? 'Success' : 'Failed'}
        </span>
      </p>
    </div>
  );
}

export function DurationChart({
  events,
  selectedEventTypes,
  timeFilter
}: DurationChartProps) {
  const { chartData, eventTypeColors } = useMemo(() => {
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

    return { chartData: data, eventTypeColors: colorMap };
  }, [events, selectedEventTypes]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
        No events to display. Select event types above to see the chart.
      </div>
    );
  }

  // Group data by event type for separate scatter series
  const dataByEventType = new Map<
    string,
    Array<{
      timestamp: number;
      durationMs: number;
      eventName: string;
      success: boolean;
    }>
  >();
  chartData.forEach((point) => {
    const existing = dataByEventType.get(point.eventName) ?? [];
    existing.push(point);
    dataByEventType.set(point.eventName, existing);
  });

  return (
    <div className="space-y-2">
      <h2 className="font-semibold text-lg">Duration Over Time</h2>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => formatXAxisTick(value, timeFilter)}
              className="text-xs"
              stroke="currentColor"
            />
            <YAxis
              dataKey="durationMs"
              type="number"
              tickFormatter={formatDuration}
              className="text-xs"
              stroke="currentColor"
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            {[...dataByEventType.entries()].map(([eventType, data]) => (
              <Scatter
                key={eventType}
                name={formatEventName(eventType)}
                data={data}
                fill={eventTypeColors.get(eventType) ?? '#2563eb'}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        {[...eventTypeColors.entries()].map(([eventType, color]) => (
          <div key={eventType} className="flex items-center gap-1">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span>{formatEventName(eventType)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
