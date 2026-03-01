import { cn } from '@tearleads/ui';

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
        'flex shrink-0 border-b bg-muted/30 px-1 [border-color:var(--soft-border)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
