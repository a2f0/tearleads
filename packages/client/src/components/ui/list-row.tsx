import { cn } from '@/lib/utils';

function ListRow({ className, ref, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-row"
      ref={ref}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg border bg-muted/50 p-3',
        className
      )}
      {...props}
    />
  );
}

export { ListRow };
