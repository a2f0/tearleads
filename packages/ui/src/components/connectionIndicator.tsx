import { cn } from '../lib/utils.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js';

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
  const tooltipText = tooltip ?? tooltipLabels[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <output
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            state === 'connected' && 'bg-success',
            state === 'connecting' && 'animate-pulse bg-muted-foreground',
            state === 'disconnected' && 'bg-destructive',
            className
          )}
          aria-label={`Connection status: ${state}`}
        />
      </TooltipTrigger>
      <TooltipContent data-testid="connection-indicator-tooltip">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
