import { cn } from '@tearleads/ui';

type WindowControlGroupAlign = 'left' | 'right';

export interface WindowControlGroupProps {
  children: React.ReactNode;
  align?: WindowControlGroupAlign | undefined;
  className?: string | undefined;
}

export function WindowControlGroup({
  children,
  align = 'left',
  className
}: WindowControlGroupProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-0.5',
        align === 'right' && 'ml-auto',
        className
      )}
    >
      {children}
    </div>
  );
}
