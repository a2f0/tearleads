import { cn } from '@tearleads/ui';

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
        'flex h-6 shrink-0 items-center border-b bg-muted/20 px-1 [border-color:var(--soft-border)]',
        className
      )}
    >
      {children}
    </div>
  );
}
