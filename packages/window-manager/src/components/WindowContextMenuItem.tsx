import { cn } from '@tearleads/ui';

type WindowContextMenuItemVariant = 'default' | 'destructive';

export interface WindowContextMenuItemProps {
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
  variant?: WindowContextMenuItemVariant | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  'data-testid'?: string | undefined;
}

const VARIANT_CLASSNAMES: Record<WindowContextMenuItemVariant, string> = {
  default: 'hover:bg-accent hover:text-accent-foreground',
  destructive:
    'text-destructive hover:bg-destructive hover:text-destructive-foreground'
};

export function WindowContextMenuItem({
  icon,
  onClick,
  children,
  variant = 'default',
  disabled,
  className,
  'data-testid': testId
}: WindowContextMenuItemProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSNAMES[variant],
        className
      )}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {icon}
      {children}
    </button>
  );
}
