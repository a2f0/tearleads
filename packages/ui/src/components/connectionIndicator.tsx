import { cn } from '../lib/utils.js';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface ConnectionIndicatorProps {
  state: ConnectionState;
  className?: string;
  tooltip?: string;
}

const tooltipLabels: Record<ConnectionState, string> = {
  connected: 'SSE: Connected',
  connecting: 'SSE: Connecting',
  disconnected: 'SSE: Disconnected'
};

export function ConnectionIndicator({
  state,
  className,
  tooltip
}: ConnectionIndicatorProps) {
  return (
    <output
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        state === 'connected' && 'bg-success',
        state === 'connecting' && 'animate-pulse bg-muted-foreground',
        state === 'disconnected' && 'bg-destructive',
        className
      )}
      aria-label={`Connection status: ${state}`}
      title={tooltip ?? tooltipLabels[state]}
    />
  );
}
