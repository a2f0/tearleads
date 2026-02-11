import { forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export interface WindowTableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  isSelected?: boolean | undefined;
  isDimmed?: boolean | undefined;
}

export const WindowTableRow = forwardRef<
  HTMLTableRowElement,
  WindowTableRowProps
>(function WindowTableRow(
  { isSelected = false, isDimmed = false, className, children, ...props },
  ref
) {
  return (
    <tr
      ref={ref}
      className={cn(
        'cursor-pointer border-border/50 border-b hover:bg-accent/50',
        isSelected && 'bg-accent/50',
        isDimmed && 'opacity-60',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
});
