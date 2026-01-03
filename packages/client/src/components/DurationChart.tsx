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

const SCATTER_DOT_RADIUS = 4;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatXAxisTick(timestamp: number, timeFilter: string): string {
  const date = new Date(timestamp);
  if (timeFilter === 'hour' || timeFilter === 'day') {
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
      <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
        No events to display. Select event types above to see the chart.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">Duration Over Time</h2>
        <span className="text-muted-foreground text-sm">
          {chartData.length} event{chartData.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={0}
        >
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) =>
                formatXAxisTick(value, timeFilter)
              }
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
                shape={<circle r={SCATTER_DOT_RADIUS} />}
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
