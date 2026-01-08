import { cn } from '@/lib/utils';

export function Card({
  className,
  ref,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      ref={ref}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
        className
      )}
      {...props}
    />
  );
}
