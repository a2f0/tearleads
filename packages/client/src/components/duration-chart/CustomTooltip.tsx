import { getEventDisplayName } from '@/db/analytics';
import { formatDuration } from './formatters';

interface TooltipPayloadItem {
  payload: {
    eventName: string;
    timestamp: number;
    durationMs: number;
    success: boolean;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

export function CustomTooltip({ active, payload }: CustomTooltipProps) {
  const firstPayload = payload?.[0];
  if (!active || !firstPayload) return null;

  const data = firstPayload.payload;
  return (
    <div className="rounded-lg border bg-background p-2 shadow-md">
      <p className="font-medium">{getEventDisplayName(data.eventName)}</p>
      <p className="text-muted-foreground text-sm">
        Duration: {formatDuration(data.durationMs)}
      </p>
      <p className="text-muted-foreground text-sm">
        Time: {new Date(data.timestamp).toLocaleString()}
      </p>
      <p className="text-sm">
        Status:{' '}
        <span className={data.success ? 'text-success' : 'text-destructive'}>
          {data.success ? 'Success' : 'Failed'}
        </span>
      </p>
    </div>
  );
}
