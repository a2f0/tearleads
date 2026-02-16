import { cn } from '../lib/utils.js';

export interface WindowControlBarProps {
  children: React.ReactNode;
  className?: string | undefined;
}

export function WindowControlBar({
  children,
  className
}: WindowControlBarProps) {
  return (
    <div
      data-testid="window-control-bar"
      className={cn(
        'flex h-6 shrink-0 items-center border-border/70 border-b bg-muted/20 px-1',
        className
      )}
    >
      {children}
    </div>
  );
}
