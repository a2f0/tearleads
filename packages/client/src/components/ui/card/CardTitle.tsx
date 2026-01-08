import { cn } from '@/lib/utils';

export function CardTitle({
  className,
  ref,
  ...props
}: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}
