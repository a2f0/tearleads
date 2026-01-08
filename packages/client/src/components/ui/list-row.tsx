import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const ListRow = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    data-slot="list-row"
    ref={ref}
    className={cn(
      'flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg border bg-muted/50 p-3',
      className
    )}
    {...props}
  />
));

ListRow.displayName = 'ListRow';

export { ListRow };
