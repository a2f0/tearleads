import { cn } from '../../lib/utils.js';

export interface WindowMenuBarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function WindowMenuBar({
  children,
  className,
  ...props
}: WindowMenuBarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 border-b border-border/70 bg-muted/30 px-1',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
