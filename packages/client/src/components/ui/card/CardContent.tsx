import { cn } from '@/lib/utils';

export function CardContent({
  className,
  ref,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      ref={ref}
      className={cn('p-6 pt-0', className)}
      {...props}
    />
  );
}
