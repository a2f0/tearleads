import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@tearleads/ui';
import type { MouseEventHandler } from 'react';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface WindowConnectionIndicatorProps {
  state: ConnectionState;
  tooltip: string;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  onContextMenu?: MouseEventHandler<HTMLButtonElement> | undefined;
  className?: string | undefined;
  indicatorClassName?: string | undefined;
}

export function WindowConnectionIndicator({
  state,
  tooltip,
  onClick,
  onContextMenu,
  className,
  indicatorClassName
}: WindowConnectionIndicatorProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-6 w-6 cursor-pointer items-center justify-center rounded-none border-none bg-transparent p-0',
        className
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <TooltipPrimitive.Provider>
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            <output
              className={cn(
                'inline-block h-2 w-2 translate-y-1 rounded-full',
                state === 'connected' && 'bg-success',
                state === 'connecting' && 'animate-pulse bg-muted-foreground',
                state === 'disconnected' && 'bg-destructive',
                indicatorClassName
              )}
              aria-label={`Connection status: ${state}`}
            />
          </TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              sideOffset={4}
              className={cn(
                'z-50 overflow-hidden rounded-md bg-popover px-3 py-1.5 text-popover-foreground text-sm shadow-md',
                'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 animate-in data-[state=closed]:animate-out',
                'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
              )}
            >
              {tooltip}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
    </button>
  );
}
