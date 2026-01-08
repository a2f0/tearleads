import { formatDuration, formatEventName } from './formatters';

interface TooltipPayloadItem {
  payload: {
    eventName: string;
    timestamp: number;
    durationMs: number;
    success: boolean;
  };
}

export function CustomTooltip({
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
