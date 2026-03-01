import { cn } from '@tearleads/ui';

export interface WindowControlButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  active?: boolean | undefined;
}

export function WindowControlButton({
  icon,
  children,
  className,
  active = false,
  type = 'button',
  ...props
}: WindowControlButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded px-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
        active && 'bg-background text-foreground',
        className
      )}
      {...props}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children ? <span className="truncate">{children}</span> : null}
    </button>
  );
}
